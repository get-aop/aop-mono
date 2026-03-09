import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkflowsFromDirectory, WorkflowLoadError } from "./workflow-loader.ts";

const validWorkflowYaml = `
version: 1
name: test-workflow
initialStep: implement
steps:
  implement:
    id: implement
    type: implement
    promptTemplate: implement.md.hbs
    maxAttempts: 1
    transitions:
      - condition: success
        target: __done__
      - condition: failure
        target: __blocked__
terminalStates:
  - __done__
  - __blocked__
`;

describe("loadWorkflowsFromDirectory", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "workflow-loader-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("discovers and loads all .yaml files from directory", async () => {
    await Bun.write(join(tempDir, "workflow1.yaml"), validWorkflowYaml);
    await Bun.write(
      join(tempDir, "workflow2.yaml"),
      validWorkflowYaml.replace("test-workflow", "workflow-two"),
    );

    const workflows = await loadWorkflowsFromDirectory(tempDir);

    expect(workflows).toHaveLength(2);
    const names = workflows.map((w) => w.name).sort();
    expect(names).toEqual(["test-workflow", "workflow-two"]);
  });

  test("returns empty array and logs warning for empty directory", async () => {
    const workflows = await loadWorkflowsFromDirectory(tempDir);

    expect(workflows).toEqual([]);
  });

  test("throws WorkflowLoadError for missing directory", async () => {
    const missingDir = join(tempDir, "nonexistent");

    await expect(loadWorkflowsFromDirectory(missingDir)).rejects.toThrow(WorkflowLoadError);
    await expect(loadWorkflowsFromDirectory(missingDir)).rejects.toThrow(
      "Workflows directory does not exist",
    );
  });

  test("ignores non-yaml files", async () => {
    await Bun.write(join(tempDir, "workflow.yaml"), validWorkflowYaml);
    await Bun.write(join(tempDir, "readme.md"), "# Readme");
    await Bun.write(join(tempDir, "config.json"), "{}");

    const workflows = await loadWorkflowsFromDirectory(tempDir);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.name).toBe("test-workflow");
  });

  test("skips yaml files with invalid syntax and loads valid ones", async () => {
    await Bun.write(join(tempDir, "valid.yaml"), validWorkflowYaml);
    await Bun.write(join(tempDir, "invalid.yaml"), "name: [unclosed bracket");

    const workflows = await loadWorkflowsFromDirectory(tempDir);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.name).toBe("test-workflow");
  });

  test("skips yaml files that fail schema validation and loads valid ones", async () => {
    await Bun.write(join(tempDir, "valid.yaml"), validWorkflowYaml);
    await Bun.write(join(tempDir, "invalid.yaml"), "version: 1\nname: test");

    const workflows = await loadWorkflowsFromDirectory(tempDir);

    expect(workflows).toHaveLength(1);
    expect(workflows[0]?.name).toBe("test-workflow");
  });

  test("returns empty array when all yaml files are invalid", async () => {
    await Bun.write(join(tempDir, "invalid.yaml"), "name: [unclosed bracket");

    const workflows = await loadWorkflowsFromDirectory(tempDir);

    expect(workflows).toEqual([]);
  });

  test("loads from real workflows directory", async () => {
    const realWorkflowsDir = join(import.meta.dir, "../../workflows");

    const workflows = await loadWorkflowsFromDirectory(realWorkflowsDir);

    expect(workflows.length).toBeGreaterThanOrEqual(4);
    const names = workflows.map((w) => w.name);
    expect(names).toContain("simple");
    expect(names).toContain("aop-default");
    expect(names).toContain("deep-research");
    expect(names).toContain("landing-page");
  });
});
