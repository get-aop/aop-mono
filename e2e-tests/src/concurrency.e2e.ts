import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import {
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  ensureChangesDir,
  getFullStatus,
  getRepoStatus,
  runAopCommand,
  setTaskStatus,
  type TestContext,
  triggerServerRefresh,
  waitForTasksInRepo,
} from "./helpers";

const E2E_TIMEOUT = 600_000;

const injectLinearMetadata = async (taskFilePath: string, metadata: string): Promise<void> => {
  const content = await Bun.file(taskFilePath).text();
  const frontmatterEnd = content.indexOf("\n---\n", 4);
  if (frontmatterEnd === -1) {
    throw new Error(`Invalid task frontmatter: ${taskFilePath}`);
  }

  const frontmatter = content.slice(4, frontmatterEnd).trimEnd();
  const body = content.slice(frontmatterEnd + 5);
  await Bun.write(taskFilePath, `---\n${frontmatter}\n${metadata}\n---\n${body}`);
};

const waitForRepoTaskMatch = async (
  repoPath: string,
  matcher: (tasks: Awaited<ReturnType<typeof waitForTasksInRepo>>) => boolean,
  env: Record<string, string>,
  timeout = 60_000,
): Promise<Awaited<ReturnType<typeof waitForTasksInRepo>>> => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const status = await getFullStatus(env);
    if (status) {
      const repoStatus = getRepoStatus(status, repoPath);
      if (matcher(repoStatus.tasks)) {
        return repoStatus.tasks;
      }
    }
    await Bun.sleep(1000);
  }

  throw new Error(`Timed out waiting for repo state: ${repoPath}`);
};

describe("concurrency limits", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext("concurrency");
  }, E2E_TIMEOUT);

  afterAll(async () => {
    if (ctx) {
      await destroyTestContext(ctx);
    }
  }, E2E_TIMEOUT);

  test(
    "surfaces waiting dependency state while unrelated work continues",
    async () => {
      const repo = await createTempRepo("concurrency", ctx.reposDir);

      try {
        await ensureChangesDir(repo.path);

        const { exitCode: initExit } = await runAopCommand(
          ["repo:init", repo.path],
          undefined,
          ctx.env,
        );
        expect(initExit).toBe(0);

        await copyFixture("blocked-test", repo.path);
        await copyFixture("concurrency-test-1", repo.path);
        await copyFixture("concurrency-test-2", repo.path);

        const tasksRoot = join(repo.path, aopPaths.relativeTaskDocs());
        await injectLinearMetadata(
          join(tasksRoot, "blocked-test", "task.md"),
          [
            "source:",
            "  provider: linear",
            "  id: lin-blocker-1",
            "  ref: DEP-1",
            "  url: https://linear.app/acme/issue/DEP-1/blocker",
          ].join("\n"),
        );
        await injectLinearMetadata(
          join(tasksRoot, "concurrency-test-2", "task.md"),
          [
            "source:",
            "  provider: linear",
            "  id: lin-dependent-1",
            "  ref: DEP-2",
            "  url: https://linear.app/acme/issue/DEP-2/dependent",
            "dependencySources:",
            "  - provider: linear",
            "    id: lin-blocker-1",
            "    ref: DEP-1",
          ].join("\n"),
        );

        await triggerServerRefresh(ctx.localServerUrl);

        const detectedTasks = await waitForTasksInRepo(repo.path, 3, {
          timeout: 60_000,
          pollInterval: 2000,
          env: ctx.env,
        });
        expect(detectedTasks).toHaveLength(3);

        const blockerTask = detectedTasks.find((task) => task.change_path.includes("blocked-test"));
        const unrelatedTask = detectedTasks.find((task) =>
          task.change_path.includes("concurrency-test-1"),
        );
        const dependentTask = detectedTasks.find((task) =>
          task.change_path.includes("concurrency-test-2"),
        );

        if (!blockerTask || !unrelatedTask || !dependentTask) {
          throw new Error("Expected blocker, unrelated, and dependent tasks to exist");
        }

        expect(await setTaskStatus(blockerTask.id, "WORKING", ctx.localServerUrl)).toBe(true);
        expect(await setTaskStatus(unrelatedTask.id, "WORKING", ctx.localServerUrl)).toBe(true);
        expect(await setTaskStatus(dependentTask.id, "READY", ctx.localServerUrl)).toBe(true);

        const waitingState = await waitForRepoTaskMatch(
          repo.path,
          (tasks) => {
            const blocker = tasks.find((task) => task.id === blockerTask.id);
            const unrelated = tasks.find((task) => task.id === unrelatedTask.id);
            const dependent = tasks.find((task) => task.id === dependentTask.id);
            return Boolean(
              blocker?.status === "WORKING" &&
                unrelated?.status === "WORKING" &&
                dependent?.status === "READY" &&
                dependent.dependencyState === "waiting",
            );
          },
          ctx.env,
        );

        const waitingDependent = waitingState.find((task) => task.id === dependentTask.id);
        expect(waitingDependent?.status).toBe("READY");
        expect(waitingDependent?.dependencyState).toBe("waiting");
        expect(waitingDependent?.blockedByRefs).toContain("DEP-1");

        const status = await getFullStatus(ctx.env);
        if (!status) {
          throw new Error("Status should not be null");
        }
        const repoStatus = getRepoStatus(status, repo.path);
        expect(repoStatus.working).toBe(2);
        expect(status.globalCapacity.working).toBeGreaterThanOrEqual(2);
      } finally {
        await repo.cleanup();
      }
    },
    E2E_TIMEOUT,
  );

  test(
    "surfaces terminal blockers for dependent READY tasks",
    async () => {
      const repo = await createTempRepo("concurrency-dependencies", ctx.reposDir);

      try {
        await ensureChangesDir(repo.path);

        const { exitCode: initExit } = await runAopCommand(
          ["repo:init", repo.path],
          undefined,
          ctx.env,
        );
        expect(initExit).toBe(0);

        await copyFixture("blocked-test", repo.path);
        await copyFixture("concurrency-test-2", repo.path);

        const tasksRoot = join(repo.path, aopPaths.relativeTaskDocs());
        await injectLinearMetadata(
          join(tasksRoot, "blocked-test", "task.md"),
          [
            "source:",
            "  provider: linear",
            "  id: lin-blocker-1",
            "  ref: DEP-1",
            "  url: https://linear.app/acme/issue/DEP-1/blocker",
          ].join("\n"),
        );
        await injectLinearMetadata(
          join(tasksRoot, "concurrency-test-2", "task.md"),
          [
            "source:",
            "  provider: linear",
            "  id: lin-dependent-1",
            "  ref: DEP-2",
            "  url: https://linear.app/acme/issue/DEP-2/dependent",
            "dependencySources:",
            "  - provider: linear",
            "    id: lin-blocker-1",
            "    ref: DEP-1",
          ].join("\n"),
        );

        await triggerServerRefresh(ctx.localServerUrl);

        const detectedTasks = await waitForTasksInRepo(repo.path, 2, {
          timeout: 60_000,
          pollInterval: 2000,
          env: ctx.env,
        });
        expect(detectedTasks).toHaveLength(2);

        const blockerTask = detectedTasks.find((task) => task.change_path.includes("blocked-test"));
        const dependentTask = detectedTasks.find((task) =>
          task.change_path.includes("concurrency-test-2"),
        );

        if (!blockerTask || !dependentTask) {
          throw new Error("Expected blocker and dependent tasks to exist");
        }

        expect(await setTaskStatus(blockerTask.id, "BLOCKED", ctx.localServerUrl)).toBe(true);
        expect(await setTaskStatus(dependentTask.id, "READY", ctx.localServerUrl)).toBe(true);

        const blockedState = await waitForRepoTaskMatch(
          repo.path,
          (tasks) => {
            const blocker = tasks.find((task) => task.id === blockerTask.id);
            const dependent = tasks.find((task) => task.id === dependentTask.id);
            return Boolean(
              blocker?.status === "BLOCKED" &&
                dependent?.status === "READY" &&
                dependent.dependencyState === "blocked",
            );
          },
          ctx.env,
        );

        const blockedDependent = blockedState.find((task) => task.id === dependentTask.id);
        expect(blockedDependent?.status).toBe("READY");
        expect(blockedDependent?.dependencyState).toBe("blocked");
        expect(blockedDependent?.blockedByRefs).toContain("DEP-1");
      } finally {
        await repo.cleanup();
      }
    },
    E2E_TIMEOUT,
  );
});
