import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { scaffoldTaskFromBrainstorm } from "./scaffold.ts";

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
    expect(await Bun.file(join(repoRoot, result.taskPath, "001-build-login-handler.md")).exists()).toBe(true);
    expect(await Bun.file(join(repoRoot, result.taskPath, "002-wire-session-storage.md")).exists()).toBe(true);
  });
});
