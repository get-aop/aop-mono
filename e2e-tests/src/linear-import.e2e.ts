import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createTempRepo,
  createTestContext,
  destroyTestContext,
  getFullStatus,
  getRepoStatus,
  runAopCommand,
  type TaskInfo,
  type TempRepoResult,
  type TestContext,
  waitForTaskMatch,
  waitForTasksInRepo,
} from "./helpers";

const E2E_TIMEOUT = 600_000;
const LINEAR_FIXTURES_PATH = resolve(import.meta.dir, "../fixtures/linear-issues.json");

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

describe("linear multi-ticket import", () => {
  let ctx: TestContext;
  let repo: TempRepoResult;

  beforeAll(async () => {
    ctx = await createTestContext("linear-import", {
      localServerEnv: {
        AOP_TEST_LINEAR_FIXTURES_PATH: LINEAR_FIXTURES_PATH,
        AOP_E2E_FIXTURE_DELAY_MS: "2500",
      },
    });
    repo = await createTempRepo("linear-import", ctx.reposDir);
  }, E2E_TIMEOUT);

  afterAll(async () => {
    await repo.cleanup();
    await destroyTestContext(ctx);
  }, E2E_TIMEOUT);

  test(
    "imports multiple Linear tickets and runs independent tasks in parallel while dependents wait",
    async () => {
      const importResponse = await fetch(`${ctx.localServerUrl}/api/linear/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: repo.path,
          input: "GET-201, GET-202, GET-203",
        }),
      });

      expect(importResponse.ok).toBe(true);
      const importBody = (await importResponse.json()) as {
        ok: boolean;
        imported: Array<{
          taskId: string;
          ref: string;
          changePath: string;
          requested: boolean;
          dependencyImported: boolean;
        }>;
        failures: Array<{ ref: string; error: string }>;
      };

      expect(importBody.ok).toBe(true);
      expect(importBody.failures).toEqual([]);
      expect(importBody.imported.map((record) => record.ref)).toEqual([
        "GET-201",
        "GET-202",
        "GET-203",
      ]);
      expect(importBody.imported.every((record) => record.requested)).toBe(true);
      expect(importBody.imported.every((record) => record.dependencyImported === false)).toBe(true);

      const detectedTasks = await waitForTasksInRepo(repo.path, 3, {
        timeout: 60_000,
        pollInterval: 500,
        env: ctx.env,
      });
      expect(detectedTasks).toHaveLength(3);

      for (const record of importBody.imported) {
        const { exitCode } = await runAopCommand(["task:ready", record.taskId], undefined, ctx.env);
        expect(exitCode).toBe(0);
      }

      const observedParallelState = await waitForRepoTaskState(
        repo.path,
        (tasks) => {
          const byRef = new Map(
            importBody.imported.map((record) => [
              record.ref,
              tasks.find((task) => task.id === record.taskId),
            ]),
          );
          const first = byRef.get("GET-201");
          const blocker = byRef.get("GET-202");
          const dependent = byRef.get("GET-203");

          return Boolean(
            first?.status === "WORKING" &&
              blocker?.status === "WORKING" &&
              dependent?.status === "READY" &&
              dependent.dependencyState === "waiting" &&
              dependent.blockedByRefs?.includes("GET-202"),
          );
        },
        ctx.env,
        90_000,
      );

      const repoStatus = getRepoStatus(
        {
          ready: true,
          globalCapacity: { working: 0, max: 0 },
          repos: [
            {
              id: "repo",
              name: null,
              path: repo.path,
              working: 0,
              max: 3,
              tasks: observedParallelState,
            },
          ],
        },
        repo.path,
      );
      expect(repoStatus.tasks.filter((task) => task.status === "WORKING")).toHaveLength(2);

      for (const record of importBody.imported) {
        const completedTask = await waitForTaskMatch(
          record.taskId,
          (task) => task.status === "DONE" && task.worktree_path === null,
          {
            timeout: 300_000,
            pollInterval: 1000,
            localServerUrl: ctx.localServerUrl,
          },
        );
        expect(completedTask?.status).toBe("DONE");
      }

      expect(existsSync(join(repo.path, "alpha.txt"))).toBe(true);
      expect(existsSync(join(repo.path, "bravo.txt"))).toBe(true);
      expect(existsSync(join(repo.path, "charlie.txt"))).toBe(true);
    },
    E2E_TIMEOUT,
  );
});
