import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CodexProvider } from "@aop/llm-provider";
import {
  assertBenchmarkFixtureIsWorkflowCompatible,
  type BenchmarkResult,
  type BenchmarkTaskTiming,
  buildBenchmarkSummaryLines,
  collectChangedFiles,
  computeMissingRequiredChangedFiles,
  computeUnexpectedChangedFiles,
  createBenchmarkRepoFromFixture,
  createBenchmarkRunDir,
  readTaskDocStatuses,
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

export const buildPureCodexBenchmarkPrompt = (scenarioId: string): string =>
  `
You are running the ${scenarioId} benchmark in the current repository.

Read:
- BENCHMARK.md
- every task folder under docs/tasks/

Benchmark rules:
1. Respect task dependencies. Do not start BENCH-3 until BENCH-1 and BENCH-2 are complete.
2. Before implementing a behavior change, follow test-driven development: write a failing test, verify it fails, then write the minimal code to pass.
3. Respect the benchmark file boundaries from BENCHMARK.md so independent tasks stay independent.
4. When you start a task, update its task.md status to WORKING.
5. Update tasks.md checklist items as you complete them.
6. When a task is complete, update its task.md status to DONE.
7. Stay within src/, tests/, and docs/tasks/ unless the benchmark explicitly requires otherwise.
8. Run \`bun test\` before finishing.
9. Do not create commits.
10. This benchmark is a closed scenario. Do not ask for user input. Use BENCHMARK.md and the task docs as the authoritative requirements.

Stop only when all benchmark tasks are DONE and the full test suite passes.
`.trim();

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

const createTaskTimings = (taskDirs: string[]): Map<string, BenchmarkTaskTiming> =>
  new Map(
    taskDirs.map((taskDir, index) => [
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

const updateSinglePureTaskTiming = (params: {
  taskDir: string;
  status: string;
  timings: Map<string, BenchmarkTaskTiming>;
  startTime: number;
}): void => {
  const { taskDir, status, timings, startTime } = params;
  const timing = timings.get(taskDir);
  if (!timing) {
    return;
  }

  if (status === "WORKING" && timing.startedAtMs === null) {
    timing.startedAtMs = Date.now() - startTime;
  }

  if (status === "DONE" && timing.completedAtMs === null) {
    timing.completedAtMs = Date.now() - startTime;
  }
};

const pollPureTaskProgress = async (params: {
  repoPath: string;
  timings: Map<string, BenchmarkTaskTiming>;
  startTime: number;
  finished: () => boolean;
}): Promise<number> => {
  const { repoPath, timings, startTime, finished } = params;
  let maxConcurrentWorkingTasks = 0;

  while (!finished() && Date.now() - startTime < MAX_DURATION_MS) {
    const statuses = await readTaskDocStatuses(repoPath);
    const workingTasks = Object.entries(statuses).filter(([, status]) => status === "WORKING");
    maxConcurrentWorkingTasks = Math.max(maxConcurrentWorkingTasks, workingTasks.length);

    for (const [taskDir, status] of Object.entries(statuses)) {
      updateSinglePureTaskTiming({ taskDir, status, timings, startTime });
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }

  return maxConcurrentWorkingTasks;
};

const buildPureBenchmarkResult = async (params: {
  scenario: ReturnType<typeof resolveBenchmarkScenario>;
  repoPath: string;
  runDir: string;
  logPath: string;
  baseRef: string;
  startTime: number;
  runResult: Awaited<ReturnType<CodexProvider["run"]>>;
  timings: Map<string, BenchmarkTaskTiming>;
  maxConcurrentWorkingTasks: number;
}): Promise<BenchmarkResult> => {
  const {
    scenario,
    repoPath,
    runDir,
    logPath,
    baseRef,
    startTime,
    runResult,
    timings,
    maxConcurrentWorkingTasks,
  } = params;

  const verification = await runCommand(scenario.verificationCommand, repoPath, process.env);
  const changedFiles = await collectChangedFiles(repoPath, baseRef);
  const unexpectedFilesChanged = computeUnexpectedChangedFiles(
    changedFiles,
    scenario.allowedChangedPathPrefixes,
  );
  const missingRequiredChangedFiles = computeMissingRequiredChangedFiles(
    changedFiles,
    scenario.requiredChangedPaths,
  );
  const finalizedTimings = finalizeTaskTimings(timings);
  const completedTimings = finalizedTimings.filter((task) => task.completedAtMs !== null);

  return {
    recordedAt: new Date().toISOString(),
    scenario: scenario.id,
    mode: "pure-codex",
    provider: "codex",
    model: process.env.AOP_CODEX_MODEL ?? null,
    workflow: null,
    reasoningEffort: process.env.AOP_CODEX_REASONING_EFFORT ?? null,
    success:
      runResult.exitCode === 0 &&
      verification.exitCode === 0 &&
      unexpectedFilesChanged.length === 0 &&
      missingRequiredChangedFiles.length === 0,
    metrics: {
      totalDurationMs: Date.now() - startTime,
      firstTaskCompletedMs:
        completedTimings.length === 0
          ? null
          : Math.min(
              ...completedTimings.map((task) => task.completedAtMs ?? Number.MAX_SAFE_INTEGER),
            ),
      maxConcurrentWorkingTasks,
      tasksCompleted: completedTimings.length,
      tasksExpected: scenario.expectedTaskDirs.length,
      finalVerificationPassed: verification.exitCode === 0,
    },
    verification,
    tasks: finalizedTimings,
    changedFiles,
    unexpectedFilesChanged,
    missingRequiredChangedFiles,
    artifacts: {
      runDir,
      repoPath,
      logPath,
    },
    notes:
      runResult.timedOut === true
        ? ["Codex run timed out because no activity was detected before the inactivity timeout."]
        : [],
  };
};

export const runPureCodexBenchmark = async (scenarioId: string): Promise<BenchmarkResult> => {
  const scenario = resolveBenchmarkScenario(scenarioId);
  await assertBenchmarkFixtureIsWorkflowCompatible(scenario);
  await assertCodexAvailable();

  const runDir = await createBenchmarkRunDir(scenario.id, "pure-codex");
  const aopHome = join(runDir, "aop-home");
  await mkdir(aopHome, { recursive: true });
  const { repoPath, baseRef } = await createBenchmarkRepoFromFixture(scenario, runDir);
  const logPath = join(runDir, "codex.log");
  const provider = new CodexProvider();
  const timings = createTaskTimings(scenario.expectedTaskDirs);
  const startTime = Date.now();
  let finished = false;

  const runPromise = provider
    .run({
      cwd: repoPath,
      prompt: buildPureCodexBenchmarkPrompt(scenario.id),
      env: {
        ...process.env,
        AOP_HOME: aopHome,
      },
      logFilePath: logPath,
      inactivityTimeoutMs: MAX_DURATION_MS,
    })
    .finally(() => {
      finished = true;
    });

  const maxConcurrentWorkingTasks = await pollPureTaskProgress({
    repoPath,
    timings,
    startTime,
    finished: () => finished,
  });

  const runResult = await runPromise;
  const result = await buildPureBenchmarkResult({
    scenario,
    repoPath,
    runDir,
    logPath,
    baseRef,
    startTime,
    runResult,
    timings,
    maxConcurrentWorkingTasks,
  });

  await writeBenchmarkResult(result, runDir);
  return result;
};

const run = async (): Promise<void> => {
  const scenarioId = parseScenarioArg(process.argv.slice(2));
  const result = await runPureCodexBenchmark(scenarioId);
  process.stdout.write(`${buildBenchmarkSummaryLines(result).join("\n")}\n`);
};

if (import.meta.main) {
  await run();
}
