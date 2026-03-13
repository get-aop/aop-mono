import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAssistantSignalTextFromRawJsonl } from "../logs";
import { E2EFixtureProvider } from "./e2e-fixture";

describe("E2EFixtureProvider", () => {
  let tempDir: string;
  let originalDelay: string | undefined;

  beforeEach(() => {
    originalDelay = process.env.AOP_E2E_FIXTURE_DELAY_MS;
    delete process.env.AOP_E2E_FIXTURE_DELAY_MS;
    tempDir = join(tmpdir(), `aop-e2e-fixture-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (originalDelay === undefined) {
      delete process.env.AOP_E2E_FIXTURE_DELAY_MS;
    } else {
      process.env.AOP_E2E_FIXTURE_DELAY_MS = originalDelay;
    }
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("writes deterministic task output from an absolute task path and a success signal log", async () => {
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

  test("supports relative task paths rooted at the worktree", async () => {
    const worktreePath = join(tempDir, "worktree");
    const relativeTaskDir = join("docs", "tasks", "relative-task");

    mkdirSync(join(worktreePath, relativeTaskDir), { recursive: true });

    await Bun.write(
      join(worktreePath, relativeTaskDir, "task.md"),
      [
        "---",
        "title: Relative Task",
        "status: DRAFT",
        "created: 2026-03-10T00:00:00.000Z",
        "---",
        "",
        "## Requirements",
        "- Create `relative.txt` in the repository root.",
        "- Write `Relative task output` to the file.",
      ].join("\n"),
    );

    const provider = new E2EFixtureProvider();

    const result = await provider.run({
      cwd: worktreePath,
      prompt: [
        "## Task Details",
        `- **Task Path**: ${relativeTaskDir}`,
        "",
        "## Signals (REQUIRED)",
        "- `<aop>ALL_TASKS_DONE</aop>`",
      ].join("\n"),
    });

    expect(result.exitCode).toBe(0);
    expect(await Bun.file(join(worktreePath, "relative.txt")).text()).toBe(
      "Relative task output\n",
    );
  });

  test("prefers TESTS_PASS for run-tests prompts in the default workflow", async () => {
    const logFilePath = join(tempDir, "logs", "run-tests.jsonl");
    const provider = new E2EFixtureProvider();

    const result = await provider.run({
      cwd: tempDir,
      logFilePath,
      prompt: [
        "## Signals (REQUIRED)",
        "- `<aop>TESTS_PASS</aop>` — required local verification passed",
        "- `<aop>TESTS_FAIL</aop>` — required local verification failed",
      ].join("\n"),
    });

    expect(result.exitCode).toBe(0);

    const logContent = await Bun.file(logFilePath).text();
    const extracted = extractAssistantSignalTextFromRawJsonl(logContent);
    expect(extracted.text).toContain("<aop>TESTS_PASS</aop>");
    expect(extracted.text).not.toContain("<aop>REVIEW_PASSED</aop>");
  });

  test("supports an optional deterministic delay for parallel execution tests", async () => {
    process.env.AOP_E2E_FIXTURE_DELAY_MS = "25";
    const provider = new E2EFixtureProvider();
    const start = Date.now();

    await provider.run({
      cwd: tempDir,
      prompt: "## Signals (REQUIRED)\n- `<aop>ALL_TASKS_DONE</aop>`",
    });

    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });
});
