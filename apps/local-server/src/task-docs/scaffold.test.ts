import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { ensureExecutionPlanArtifacts, scaffoldTaskFromBrainstorm } from "./scaffold.ts";

describe("task-docs/scaffold", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = join(tmpdir(), `aop-scaffold-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("creates task.md, plan.md, and numbered subtask files", async () => {
    const result = await scaffoldTaskFromBrainstorm(repoRoot, "auth-flow", {
      title: "Auth Flow",
      description: "Restore the auth workflow",
      requirements: ["Build login handler", "Wire session storage"],
      acceptanceCriteria: ["User can log in", "Session persists"],
    });

    expect(result.taskName).toBe("auth-flow");
    expect(result.taskPath).toBe(join(aopPaths.relativeTaskDocs(), "auth-flow"));
    expect(await Bun.file(join(repoRoot, result.taskPath, "task.md")).exists()).toBe(true);
    expect(await Bun.file(join(repoRoot, result.taskPath, "plan.md")).exists()).toBe(true);
    expect(
      await Bun.file(join(repoRoot, result.taskPath, "001-build-login-handler.md")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(repoRoot, result.taskPath, "002-wire-session-storage.md")).exists(),
    ).toBe(true);
  });

  test("backfills plan.md and numbered subtasks from a legacy tasks.md checklist", async () => {
    const taskDir = join(repoRoot, aopPaths.relativeTaskDocs(), "legacy-task");
    mkdirSync(taskDir, { recursive: true });

    await Bun.write(
      join(taskDir, "task.md"),
      [
        "---",
        "title: Legacy Task",
        "status: DRAFT",
        "created: 2026-03-10T00:00:00.000Z",
        "---",
        "",
        "## Description",
        "Ship a small legacy task.",
        "",
        "## Requirements",
        "- First requirement",
        "",
        "## Acceptance Criteria",
        "- [ ] Acceptance criterion",
        "",
      ].join("\n"),
    );
    await Bun.write(
      join(taskDir, "tasks.md"),
      ["## Checklist", "", "- [ ] Create hello.txt", "- [ ] Verify greeting text"].join("\n"),
    );

    const createdFiles = await ensureExecutionPlanArtifacts(taskDir);

    expect(createdFiles).toContain(join(taskDir, "plan.md"));
    expect(createdFiles).toContain(join(taskDir, "001-create-hellotxt.md"));
    expect(createdFiles).toContain(join(taskDir, "002-verify-greeting-text.md"));
    expect(createdFiles).toHaveLength(3);
    expect(await Bun.file(join(taskDir, "plan.md")).exists()).toBe(true);
    expect(await Bun.file(join(taskDir, "001-create-hellotxt.md")).exists()).toBe(true);
    expect(await Bun.file(join(taskDir, "002-verify-greeting-text.md")).exists()).toBe(true);
    expect(await Bun.file(join(taskDir, "003-acceptance-criterion.md")).exists()).toBe(false);
  });
});
