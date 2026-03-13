import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DASHBOARD_PORT_RANGE,
  LOCAL_SERVER_PORT_RANGE,
} from "../e2e-tests/src/helpers/constants.ts";
import { runAopCommand } from "../e2e-tests/src/helpers/e2e-server.ts";
import {
  startLocalServer,
  stopLocalServer,
  triggerServerRefresh,
} from "../e2e-tests/src/helpers/local-server.ts";
import {
  getFullStatus,
  getRepoStatus,
  type TaskInfo,
  waitForTasksInRepo,
} from "../e2e-tests/src/helpers/status.ts";
import { findFreePort } from "../e2e-tests/src/helpers/test-context.ts";
import {
  type BenchmarkResult,
  type BenchmarkScenario,
  type BenchmarkTaskTiming,
  buildBenchmarkSummaryLines,
  collectChangedFilesSince,
  computeUnexpectedChangedFiles,
  createBenchmarkRepoFromFixture,
  createBenchmarkRunDir,
  resolveBenchmarkScenario,
  runCommand,
  writeBenchmarkResult,
} from "./benchmark/shared.ts";

const DEFAULT_SCENARIO = "notes-cli";
const POLL_INTERVAL_MS = 1_000;
const MAX_DURATION_MS = 30 * 60 * 1_000;

export const parseScenarioArg = (argv: string[]): string => {
  const explicit = argv.find((arg) => arg.startsWith("--scenario="));
  return explicit?.split("=")[1]?.trim() || process.env.AOP_BENCHMARK_SCENARIO || DEFAULT_SCENARIO;
};

const assertCodexAvailable = async (): Promise<void> => {
  const which = Bun.spawn({
    cmd: ["bash", "-lc", "command -v codex >/dev/null && test -f ~/.codex/auth.json"],
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await which.exited) !== 0) {
    throw new Error(
      "Codex CLI is not ready. Ensure `codex` is in PATH and ~/.codex/auth.json exists.",
    );
  }
};

const buildAopEnv = (params: {
  aopHome: string;
  dbPath: string;
  localServerPort: number;
  dashboardPort: number;
}): Record<string, string> => ({
  ...process.env,
  AOP_HOME: params.aopHome,
  AOP_DB_PATH: params.dbPath,
  AOP_LOCAL_SERVER_PORT: String(params.localServerPort),
  AOP_LOCAL_SERVER_URL: `http://127.0.0.1:${params.localServerPort}`,
  AOP_DASHBOARD_PORT: String(params.dashboardPort),
  AOP_DASHBOARD_URL: `http://127.0.0.1:${params.dashboardPort}`,
});

const configureAopBenchmark = async (env: Record<string, string>): Promise<void> => {
  const setProvider = await runAopCommand(
    ["config:set", "agent_provider", "codex"],
    undefined,
    env,
  );
  if (setProvider.exitCode !== 0) {
    throw new Error(`Failed to set agent_provider=codex: ${setProvider.stderr}`);
  }

  const setWorkflow = await runAopCommand(
    ["config:set", "default_workflow", "aop-default"],
    undefined,
    env,
  );
  if (setWorkflow.exitCode !== 0) {
    throw new Error(`Failed to set default_workflow=aop-default: ${setWorkflow.stderr}`);
  }
};

const waitForDependencyMirror = async (
  scenario: BenchmarkScenario,
  repoPath: string,
  env: Record<string, string>,
): Promise<void> => {
  if (!scenario.expectedBlockedRefs || Object.keys(scenario.expectedBlockedRefs).length === 0) {
    return;
  }

  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const status = await getFullStatus(env);
    if (status) {
      const repoStatus = getRepoStatus(status, repoPath);
      const mirrorReady = Object.entries(scenario.expectedBlockedRefs).every(
        ([taskDir, blockedRefs]) => {
          const task = repoStatus.tasks.find((entry) => entry.change_path.endsWith(taskDir));
          return task ? blockedRefs.every((ref) => task.blockedByRefs?.includes(ref)) : false;
        },
      );

      if (mirrorReady) {
        return;
      }
    }

    await Bun.sleep(500);
  }

  throw new Error("Timed out waiting for benchmark dependency mirror to be ready");
};

const initializeAopBenchmark = async (
  scenario: BenchmarkScenario,
  repoPath: string,
  expectedTaskCount: number,
  env: Record<string, string>,
): Promise<TaskInfo[]> => {
  await configureAopBenchmark(env);
  const initRepo = await runAopCommand(["repo:init", repoPath], undefined, env);
  if (initRepo.exitCode !== 0) {
    throw new Error(`Failed to register benchmark repo: ${initRepo.stderr}`);
  }

  const refreshed = await triggerServerRefresh(env.AOP_LOCAL_SERVER_URL);
  if (!refreshed) {
    throw new Error("Failed to trigger orchestrator refresh for benchmark repo");
  }

  const tasks = await waitForTasksInRepo(repoPath, expectedTaskCount, {
    timeout: 60_000,
    pollInterval: 500,
    env,
  });

  await waitForDependencyMirror(scenario, repoPath, env);
  return tasks;
};

const buildTaskRefMap = (tasks: TaskInfo[]): Map<string, string> =>
  new Map(
    tasks.map((task) => {
      const taskDir = task.change_path.split("/").at(-1) ?? task.id;
      return [taskDir, task.id];
    }),
  );

const createTaskTimings = (scenarioTaskDirs: string[]): Map<string, BenchmarkTaskTiming> =>
  new Map(
    scenarioTaskDirs.map((taskDir, index) => [
      taskDir,
      {
        taskDir,
        ref: `BENCH-${index + 1}`,
        startedAtMs: null,
        completedAtMs: null,
        dependencyWaitingObserved: false,
      },
    ]),
  );

const finalizeTaskTimings = (timings: Map<string, BenchmarkTaskTiming>): BenchmarkTaskTiming[] =>
  [...timings.values()].sort((left, right) => left.ref.localeCompare(right.ref));

const readyBenchmarkTasks = async (
  scenarioTaskDirs: string[],
  taskIdByDir: Map<string, string>,
  env: Record<string, string>,
): Promise<void> => {
  for (const taskDir of scenarioTaskDirs) {
    const taskId = taskIdByDir.get(taskDir);
    if (!taskId) {
      throw new Error(`Task not discovered for benchmark scenario: ${taskDir}`);
    }

    const ready = await runAopCommand(["task:ready", taskId], undefined, env);
    if (ready.exitCode !== 0) {
      throw new Error(`Failed to mark task READY (${taskDir}): ${ready.stderr}`);
    }
  }
};

const updateSingleAopTaskTiming = (
  task: TaskInfo,
  timings: Map<string, BenchmarkTaskTiming>,
  startTime: number,
): void => {
  const taskDir = task.change_path.split("/").at(-1);
  if (!taskDir) {
    return;
  }

  const timing = timings.get(taskDir);
  if (!timing) {
    return;
  }

  if (task.status === "WORKING" && timing.startedAtMs === null) {
    timing.startedAtMs = Date.now() - startTime;
  }

  if (task.dependencyState === "waiting") {
    timing.dependencyWaitingObserved = true;
  }

  if (task.status === "DONE" && task.worktree_path === null && timing.completedAtMs === null) {
    timing.completedAtMs = Date.now() - startTime;
  }
};

const updateTaskTimingsFromStatus = (params: {
  repoTasks: TaskInfo[];
  timings: Map<string, BenchmarkTaskTiming>;
  startTime: number;
}): number => {
  const { repoTasks, timings, startTime } = params;
  const workingCount = repoTasks.filter((task) => task.status === "WORKING").length;

  for (const task of repoTasks) {
    updateSingleAopTaskTiming(task, timings, startTime);
  }

  return workingCount;
};

const buildAopBenchmarkResult = async (params: {
  scenario: BenchmarkScenario;
  runDir: string;
  repoPath: string;
  baseRef: string;
  startTime: number;
  maxConcurrentWorkingTasks: number;
  timings: Map<string, BenchmarkTaskTiming>;
}): Promise<BenchmarkResult> => {
  const { scenario, runDir, repoPath, baseRef, startTime, maxConcurrentWorkingTasks, timings } =
    params;
  const verification = await runCommand(scenario.verificationCommand, repoPath, process.env);
  const changedFiles = await collectChangedFilesSince(repoPath, baseRef);
  const unexpectedFilesChanged = computeUnexpectedChangedFiles(
    changedFiles,
    scenario.allowedChangedPathPrefixes,
  );
  const finalizedTimings = finalizeTaskTimings(timings);
  const completedTimings = finalizedTimings
    .map((task) => task.completedAtMs)
    .filter((value): value is number => value !== null);

  return {
    recordedAt: new Date().toISOString(),
    scenario: scenario.id,
    mode: "aop-codex",
    provider: "codex",
    model: process.env.AOP_CODEX_MODEL ?? null,
    reasoningEffort: process.env.AOP_CODEX_REASONING_EFFORT ?? null,
    success: verification.exitCode === 0 && unexpectedFilesChanged.length === 0,
    metrics: {
      totalDurationMs: Date.now() - startTime,
      firstTaskCompletedMs: completedTimings.length > 0 ? Math.min(...completedTimings) : null,
      maxConcurrentWorkingTasks,
      tasksCompleted: finalizedTimings.filter((task) => task.completedAtMs !== null).length,
      tasksExpected: scenario.expectedTaskDirs.length,
      finalVerificationPassed: verification.exitCode === 0,
    },
    verification,
    tasks: finalizedTimings,
    changedFiles,
    unexpectedFilesChanged,
    artifacts: {
      runDir,
      repoPath,
      logPath: null,
    },
    notes: [],
  };
};

export const runAopCodexBenchmark = async (scenarioId: string): Promise<BenchmarkResult> => {
  const scenario = resolveBenchmarkScenario(scenarioId);
  await assertCodexAvailable();

  const runDir = await createBenchmarkRunDir(scenario.id, "aop-codex");
  const aopHome = join(runDir, "aop-home");
  await mkdir(aopHome, { recursive: true });
  const dbPath = join(runDir, "aop.db");
  const { repoPath, baseRef } = await createBenchmarkRepoFromFixture(scenario, runDir);
  const localServerPort = await findFreePort(
    LOCAL_SERVER_PORT_RANGE.min,
    LOCAL_SERVER_PORT_RANGE.max,
  );
  const dashboardPort = await findFreePort(DASHBOARD_PORT_RANGE.min, DASHBOARD_PORT_RANGE.max);
  const env = buildAopEnv({ aopHome, dbPath, localServerPort, dashboardPort });
  const localServer = await startLocalServer({
    port: localServerPort,
    dbPath,
    env,
  });

  try {
    const discoveredTasks = await initializeAopBenchmark(
      scenario,
      repoPath,
      scenario.expectedTaskDirs.length,
      env,
    );
    const taskIdByDir = buildTaskRefMap(discoveredTasks);
    const timings = createTaskTimings(scenario.expectedTaskDirs);
    await readyBenchmarkTasks(scenario.expectedTaskDirs, taskIdByDir, env);

    const startTime = Date.now();
    let maxConcurrentWorkingTasks = 0;

    while (Date.now() - startTime < MAX_DURATION_MS) {
      const status = await getFullStatus(env);
      if (!status) {
        await Bun.sleep(POLL_INTERVAL_MS);
        continue;
      }

      const repoStatus = getRepoStatus(status, repoPath);
      const workingCount = updateTaskTimingsFromStatus({
        repoTasks: repoStatus.tasks,
        timings,
        startTime,
      });
      maxConcurrentWorkingTasks = Math.max(maxConcurrentWorkingTasks, workingCount);

      if ([...timings.values()].every((task) => task.completedAtMs !== null)) {
        const result = await buildAopBenchmarkResult({
          scenario,
          runDir,
          repoPath,
          baseRef,
          startTime,
          maxConcurrentWorkingTasks,
          timings,
        });

        await writeBenchmarkResult(result, runDir);
        return result;
      }

      await Bun.sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`Benchmark timed out after ${MAX_DURATION_MS / 1000}s`);
  } finally {
    await stopLocalServer(localServer);
  }
};

const run = async (): Promise<void> => {
  const scenarioId = parseScenarioArg(process.argv.slice(2));
  const result = await runAopCodexBenchmark(scenarioId);
  process.stdout.write(`${buildBenchmarkSummaryLines(result).join("\n")}\n`);
};

if (import.meta.main) {
  await run();
}
