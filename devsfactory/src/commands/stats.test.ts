import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { runStatsCommand, parseStatsArgs } from "./stats";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TEST_DIR = "/tmp/stats-command-test";
const DEVSFACTORY_DIR = join(TEST_DIR, ".devsfactory");

const formatYamlValue = (value: unknown, indent: number): string => {
  const spaces = " ".repeat(indent);
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((v) => `\n${spaces}- ${formatYamlValue(v, indent + 2)}`)
      .join("");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([k, v]) => {
        if (typeof v === "object" && v !== null && !Array.isArray(v)) {
          return `\n${spaces}${k}:${formatYamlValue(v, indent + 2)}`;
        }
        return `\n${spaces}${k}: ${formatYamlValue(v, indent + 2)}`;
      })
      .join("");
  }
  return String(value);
};

const createTaskFile = async (
  taskFolder: string,
  frontmatter: Record<string, unknown>,
  body = "## Description\nTest task\n\n## Requirements\nNone\n\n## Acceptance Criteria\n- [ ] Done"
) => {
  const dirPath = join(DEVSFACTORY_DIR, taskFolder);
  await mkdir(dirPath, { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  await writeFile(join(dirPath, "task.md"), `---\n${yaml}\n---\n${body}`);
};

const createSubtaskFile = async (
  taskFolder: string,
  filename: string,
  frontmatter: Record<string, unknown>,
  body = "### Description\nTest subtask"
) => {
  const dirPath = join(DEVSFACTORY_DIR, taskFolder);
  await mkdir(dirPath, { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        return `${k}:${formatYamlValue(v, 2)}`;
      }
      return `${k}: ${formatYamlValue(v, 2)}`;
    })
    .join("\n");
  await writeFile(join(dirPath, filename), `---\n${yaml}\n---\n${body}`);
};

describe("parseStatsArgs", () => {
  test("parses task folder from args", () => {
    const result = parseStatsArgs(["my-task"]);
    expect(result.taskFolder).toBe("my-task");
    expect(result.format).toBe("json");
    expect(result.error).toBeUndefined();
  });

  test("parses --format json option", () => {
    const result = parseStatsArgs(["my-task", "--format", "json"]);
    expect(result.taskFolder).toBe("my-task");
    expect(result.format).toBe("json");
    expect(result.error).toBeUndefined();
  });

  test("returns error when task folder is missing", () => {
    const result = parseStatsArgs([]);
    expect(result.error).toBe("Missing task folder argument");
  });

  test("returns error for unknown format", () => {
    const result = parseStatsArgs(["my-task", "--format", "xml"]);
    expect(result.error).toBe("Unknown format: xml");
  });

  test("returns error for unknown option", () => {
    const result = parseStatsArgs(["my-task", "--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });
});

describe("runStatsCommand", () => {
  beforeEach(async () => {
    await mkdir(DEVSFACTORY_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("outputs valid JSON for a task", async () => {
    await createTaskFile("my-task", {
      title: "Build dashboard",
      status: "DONE",
      created: "2026-01-27T10:00:00Z",
      priority: "medium",
      startedAt: "2026-01-27T10:05:00Z",
      completedAt: "2026-01-27T10:15:00Z",
      durationMs: 600000
    });

    await createSubtaskFile("my-task", "001-first.md", {
      title: "First subtask",
      status: "DONE",
      dependencies: [],
      timing: {
        startedAt: "2026-01-27T10:05:00Z",
        completedAt: "2026-01-27T10:15:00Z",
        durationMs: 600000,
        phases: {
          implementation: 500000,
          review: 80000,
          merge: 20000,
          conflictSolver: null
        }
      }
    });

    const result = await runStatsCommand("my-task", DEVSFACTORY_DIR);

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();

    const parsed = JSON.parse(result.output!);
    expect(parsed.task).toBe("Build dashboard");
    expect(parsed.taskFolder).toBe("my-task");
    expect(parsed.durationMs).toBe(600000);
    expect(parsed.subtasks).toHaveLength(1);
    expect(parsed.summary.totalSubtasks).toBe(1);
  });

  test("returns error for non-existent task", async () => {
    const result = await runStatsCommand("nonexistent", DEVSFACTORY_DIR);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Task file not found");
  });

  test("outputs pretty-printed JSON", async () => {
    await createTaskFile("pretty-task", {
      title: "Pretty task",
      status: "PENDING",
      created: "2026-01-27T10:00:00Z",
      priority: "low"
    });

    const result = await runStatsCommand("pretty-task", DEVSFACTORY_DIR);

    expect(result.success).toBe(true);
    expect(result.output).toContain("\n");
    expect(result.output).toContain('  "task"');
  });
});
