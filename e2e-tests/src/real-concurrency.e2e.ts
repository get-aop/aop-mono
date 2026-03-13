import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import {
  copyFixture,
  createTempRepo,
  createTestContext,
  destroyTestContext,
  getFullStatus,
  getRepoStatus,
  runAopCommand,
  type TaskInfo,
  type TempRepoResult,
  type TestContext,
  triggerServerRefresh,
  waitForTaskMatch,
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

const waitForRepoTaskState = async (
  repoPath: string,
  matcher: (tasks: TaskInfo[]) => boolean,
  env: Record<string, string>,
  timeout = 60_000,
): Promise<TaskInfo[]> => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const status = await getFullStatus(env);
    if (status) {
      const repoStatus = getRepoStatus(status, repoPath);
      if (matcher(repoStatus.tasks)) {
        return repoStatus.tasks;
      }
    }

    await Bun.sleep(500);
  }

  throw new Error(`Timed out waiting for repo task state: ${repoPath}`);
};

describe("real dependency-aware concurrency", () => {
  let ctx: TestContext;
  let repo: TempRepoResult;

  beforeAll(async () => {
    ctx = await createTestContext("real-concurrency", {
      localServerEnv: {
        AOP_E2E_FIXTURE_DELAY_MS: "2500",
      },
    });
    repo = await createTempRepo("real-concurrency", ctx.reposDir);
  }, E2E_TIMEOUT);

  afterAll(async () => {
    await repo.cleanup();
    await destroyTestContext(ctx);
  }, E2E_TIMEOUT);

  test(
    "runs independent task docs in parallel while a dependent task waits and then completes",
    async () => {
      const { exitCode: initExit } = await runAopCommand(
        ["repo:init", repo.path],
        undefined,
        ctx.env,
      );
      expect(initExit).toBe(0);

      await copyFixture("concurrency-test-1", repo.path);
      await copyFixture("concurrency-test-2", repo.path);
      await copyFixture("concurrency-test-3", repo.path);

      const tasksRoot = join(repo.path, aopPaths.relativeTaskDocs());
      await injectLinearMetadata(
        join(tasksRoot, "concurrency-test-2", "task.md"),
        [
          "source:",
          "  provider: linear",
          "  id: lin-concurrency-2",
          "  ref: DEP-2",
          "  url: https://linear.app/acme/issue/DEP-2/task-2",
        ].join("\n"),
      );
      await injectLinearMetadata(
        join(tasksRoot, "concurrency-test-3", "task.md"),
        [
          "source:",
          "  provider: linear",
          "  id: lin-concurrency-3",
          "  ref: DEP-3",
          "  url: https://linear.app/acme/issue/DEP-3/task-3",
          "dependencySources:",
          "  - provider: linear",
          "    id: lin-concurrency-2",
          "    ref: DEP-2",
        ].join("\n"),
      );

      await triggerServerRefresh(ctx.localServerUrl);

      const detectedTasks = await waitForTasksInRepo(repo.path, 3, {
        timeout: 60_000,
        pollInterval: 500,
        env: ctx.env,
      });
      expect(detectedTasks).toHaveLength(3);

      const byChangePath = new Map(detectedTasks.map((task) => [task.change_path, task]));
      const firstTask = byChangePath.get("docs/tasks/concurrency-test-1");
      const secondTask = byChangePath.get("docs/tasks/concurrency-test-2");
      const dependentTask = byChangePath.get("docs/tasks/concurrency-test-3");

      if (!firstTask || !secondTask || !dependentTask) {
        throw new Error("Expected three concurrency tasks to exist");
      }

      for (const task of [firstTask, secondTask, dependentTask]) {
        const { exitCode } = await runAopCommand(["task:ready", task.id], undefined, ctx.env);
        expect(exitCode).toBe(0);
      }

      const observedParallelState = await waitForRepoTaskState(
        repo.path,
        (tasks) => {
          const first = tasks.find((task) => task.id === firstTask.id);
          const second = tasks.find((task) => task.id === secondTask.id);
          const dependent = tasks.find((task) => task.id === dependentTask.id);

          return Boolean(
            first?.status === "WORKING" &&
              second?.status === "WORKING" &&
              dependent?.status === "READY" &&
              dependent.dependencyState === "waiting" &&
              dependent.blockedByRefs?.includes("DEP-2"),
          );
        },
        ctx.env,
        90_000,
      );

      expect(observedParallelState.filter((task) => task.status === "WORKING")).toHaveLength(2);

      for (const task of [firstTask, secondTask, dependentTask]) {
        const completedTask = await waitForTaskMatch(
          task.id,
          (currentTask) => currentTask.status === "DONE" && currentTask.worktree_path === null,
          {
            timeout: 300_000,
            pollInterval: 1000,
            localServerUrl: ctx.localServerUrl,
          },
        );
        expect(completedTask?.status).toBe("DONE");
      }

      expect(await Bun.file(join(repo.path, "task1.txt")).text()).toBe("Task 1 completed\n");
      expect(await Bun.file(join(repo.path, "task2.txt")).text()).toBe("Task 2 completed\n");
      expect(await Bun.file(join(repo.path, "task3.txt")).text()).toBe("Task 3 completed\n");
    },
    E2E_TIMEOUT,
  );
});
