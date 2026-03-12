import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAssistantSignalTextFromRawJsonl } from "../logs";
import { E2EFixtureProvider } from "./e2e-fixture";

describe("E2EFixtureProvider", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `aop-e2e-fixture-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("writes deterministic task output and a success signal log", async () => {
    const worktreePath = join(tempDir, "worktree");
    const taskDir = join(tempDir, "docs", "tasks", "backlog-test");
    const logFilePath = join(tempDir, "logs", "step.jsonl");

    mkdirSync(worktreePath, { recursive: true });
    mkdirSync(taskDir, { recursive: true });

    await Bun.write(
      join(taskDir, "task.md"),
      [
        "---",
        "title: Backlog Test",
        "status: DRAFT",
        "created: 2026-03-10T00:00:00.000Z",
        "---",
        "",
        "## Requirements",
        "- Create `hello.txt` in the repository root.",
        "- Write `Hello from AOP backlog test!` to the file.",
      ].join("\n"),
    );
    await Bun.write(
      join(taskDir, "tasks.md"),
      '- [ ] Create hello.txt in the repository root with content "Hello from AOP backlog test!"\n',
    );

    const provider = new E2EFixtureProvider();

    const result = await provider.run({
      cwd: worktreePath,
      logFilePath,
      prompt: [
        "## Task Details",
        `- **Task Path**: ${taskDir}`,
        "",
        "## Signals (REQUIRED)",
        "- `<aop>ALL_TASKS_DONE</aop>`",
      ].join("\n"),
    });

    expect(result.exitCode).toBe(0);
    expect(await Bun.file(join(worktreePath, "hello.txt")).text()).toBe(
      "Hello from AOP backlog test!\n",
    );

    const updatedTasks = await Bun.file(join(taskDir, "tasks.md")).text();
    expect(updatedTasks).toContain("- [x] Create hello.txt");

    const updatedTaskDoc = await Bun.file(join(taskDir, "task.md")).text();
    expect(updatedTaskDoc).toContain("status: DONE");

    const logContent = await Bun.file(logFilePath).text();
    const extracted = extractAssistantSignalTextFromRawJsonl(logContent);
    expect(extracted.text).toContain("<aop>ALL_TASKS_DONE</aop>");
  });
});
