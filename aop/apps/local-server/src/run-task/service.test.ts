import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { SessionRepository } from "../session/repository.ts";
import { createInMemorySessionRepository, createMockContext } from "../session/test-utils/index.ts";
import { createRunTaskService } from "./service.ts";

describe("run-task/service", () => {
  let sessionRepository: SessionRepository;
  let ctx: LocalServerContext;
  let repoRoot: string;

  beforeEach(() => {
    sessionRepository = createInMemorySessionRepository();
    ctx = createMockContext(sessionRepository);
    repoRoot = join(tmpdir(), `aop-run-task-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("creates a docs task scaffold and completes the session", async () => {
    const service = createRunTaskService(ctx);

    const result = await service.run({ changeName: "My Feature", cwd: repoRoot });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.changeName).toBe("my-feature");
    expect(
      await Bun.file(join(repoRoot, aopPaths.relativeTaskDocs(), "my-feature", "task.md")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(repoRoot, aopPaths.relativeTaskDocs(), "my-feature", "plan.md")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(
        join(repoRoot, aopPaths.relativeTaskDocs(), "my-feature", "001-my-feature.md"),
      ).exists(),
    ).toBe(true);

    const stored = await sessionRepository.get(result.sessionId);
    expect(stored?.status).toBe("completed");
  });

  test("returns an error when the task root cannot be created", async () => {
    const service = createRunTaskService(ctx);
    const impossiblePath = join(repoRoot, "missing", "child");

    await Bun.write(join(repoRoot, "missing"), "not a directory");
    const result = await service.run({ changeName: "My Feature", cwd: impossiblePath });

    expect(result.status).toBe("error");
  });
});
