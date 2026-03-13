import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type BenchmarkMode = "aop-codex" | "pure-codex";

export interface BenchmarkScenario {
  id: string;
  title: string;
  fixturePath: string;
  verificationCommand: string[];
  expectedTaskDirs: string[];
  expectedBlockedRefs?: Record<string, string[]>;
  allowedChangedPathPrefixes: string[];
  requiredChangedPaths: string[];
}

export interface BenchmarkMetrics {
  totalDurationMs: number;
  firstTaskCompletedMs: number | null;
  maxConcurrentWorkingTasks: number;
  tasksCompleted: number;
  tasksExpected: number;
  finalVerificationPassed: boolean;
}

export interface BenchmarkTaskTiming {
  taskDir: string;
  ref: string;
  startedAtMs: number | null;
  completedAtMs: number | null;
  dependencyWaitingObserved: boolean;
}

export interface BenchmarkVerificationResult {
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface BenchmarkResult {
  recordedAt: string;
  scenario: string;
  mode: BenchmarkMode;
  provider: string;
  model: string | null;
  reasoningEffort: string | null;
  success: boolean;
  metrics: BenchmarkMetrics;
  verification: BenchmarkVerificationResult;
  tasks: BenchmarkTaskTiming[];
  changedFiles: string[];
  unexpectedFilesChanged: string[];
  missingRequiredChangedFiles: string[];
  artifacts: {
    runDir: string;
    repoPath: string;
    logPath: string | null;
  };
  notes: string[];
}

export interface BenchmarkComparisonSummary {
  scenario: string;
  aopMode: BenchmarkMode;
  pureMode: BenchmarkMode;
  totalDurationDeltaMs: number;
  totalDurationImprovementPct: number | null;
  firstCompletionDeltaMs: number | null;
  firstCompletionImprovementPct: number | null;
}

const BENCHMARK_ROOT = join(homedir(), ".aop", "benchmarks");
const BENCHMARK_RUNS_ROOT = join(BENCHMARK_ROOT, "runs");
const BENCHMARK_RESULTS_ROOT = join(BENCHMARK_ROOT, "results");
const FIXTURE_ROOT = resolve(dirname(import.meta.path), "../../e2e-tests/benchmark-fixtures");

export const BENCHMARK_SCENARIOS: Record<string, BenchmarkScenario> = {
  "notes-cli": {
    id: "notes-cli",
    title: "Notes CLI Task Graph",
    fixturePath: join(FIXTURE_ROOT, "notes-cli"),
    verificationCommand: ["bun", "test"],
    expectedTaskDirs: [
      "benchmark-filter-by-tag",
      "benchmark-pretty-summary",
      "benchmark-cli-report",
    ],
    expectedBlockedRefs: {
      "benchmark-cli-report": ["BENCH-1", "BENCH-2"],
    },
    allowedChangedPathPrefixes: ["src/", "tests/", "docs/tasks/"],
    requiredChangedPaths: [
      "src/notes.ts",
      "src/report.ts",
      "src/cli.ts",
      "tests/notes.test.ts",
      "tests/report.test.ts",
      "tests/cli.test.ts",
    ],
  },
};

export const resolveBenchmarkScenario = (scenarioId: string): BenchmarkScenario => {
  const scenario = BENCHMARK_SCENARIOS[scenarioId];
  if (!scenario) {
    throw new Error(`Unknown benchmark scenario: ${scenarioId}`);
  }
  return scenario;
};

export const assertBenchmarkFixtureIsWorkflowCompatible = async (
  scenario: BenchmarkScenario,
): Promise<void> => {
  const requiredFiles = ["BENCHMARK.md", "package.json", ".github/workflows/aop-ci.yml"];

  for (const relativePath of requiredFiles) {
    const filePath = join(scenario.fixturePath, relativePath);
    const fileContent = await readFile(filePath, "utf-8").catch(() => null);
    if (fileContent === null) {
      throw new Error(
        `Benchmark fixture "${scenario.id}" is missing required file: ${relativePath}`,
      );
    }
  }
};

export const readTaskDocStatuses = async (repoPath: string): Promise<Record<string, string>> => {
  const tasksRoot = join(repoPath, "docs", "tasks");
  const entries = await readdir(tasksRoot, { withFileTypes: true }).catch(() => []);
  const statuses: Record<string, string> = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const taskFilePath = join(tasksRoot, entry.name, "task.md");
    const content = await readFile(taskFilePath, "utf-8").catch(() => null);
    if (!content) {
      continue;
    }

    const statusMatch = content.match(/^status:\s*(.+)$/m);
    if (!statusMatch?.[1]) {
      continue;
    }

    statuses[entry.name] = statusMatch[1].trim();
  }

  return statuses;
};

export const computeUnexpectedChangedFiles = (
  changedFiles: string[],
  allowedPrefixes: string[],
): string[] => {
  return changedFiles.filter(
    (filePath) =>
      !allowedPrefixes.some((prefix) => filePath === prefix || filePath.startsWith(prefix)),
  );
};

export const computeMissingRequiredChangedFiles = (
  changedFiles: string[],
  requiredPaths: string[],
): string[] => requiredPaths.filter((requiredPath) => !changedFiles.includes(requiredPath));

export const summarizeBenchmarkComparison = (
  aopResult: BenchmarkResult,
  pureResult: BenchmarkResult,
): BenchmarkComparisonSummary => ({
  scenario: aopResult.scenario,
  aopMode: aopResult.mode,
  pureMode: pureResult.mode,
  totalDurationDeltaMs: aopResult.metrics.totalDurationMs - pureResult.metrics.totalDurationMs,
  totalDurationImprovementPct: calculateImprovementPct(
    pureResult.metrics.totalDurationMs,
    aopResult.metrics.totalDurationMs,
  ),
  firstCompletionDeltaMs:
    aopResult.metrics.firstTaskCompletedMs === null ||
    pureResult.metrics.firstTaskCompletedMs === null
      ? null
      : aopResult.metrics.firstTaskCompletedMs - pureResult.metrics.firstTaskCompletedMs,
  firstCompletionImprovementPct:
    aopResult.metrics.firstTaskCompletedMs === null ||
    pureResult.metrics.firstTaskCompletedMs === null
      ? null
      : calculateImprovementPct(
          pureResult.metrics.firstTaskCompletedMs,
          aopResult.metrics.firstTaskCompletedMs,
        ),
});

export const createBenchmarkRunDir = async (
  scenarioId: string,
  mode: BenchmarkMode,
): Promise<string> => {
  await mkdir(BENCHMARK_RUNS_ROOT, { recursive: true });
  const prefix = `${scenarioId}-${mode}-`;
  return await mkdtemp(join(BENCHMARK_RUNS_ROOT, prefix));
};

export const createBenchmarkRepoFromFixture = async (
  scenario: BenchmarkScenario,
  runDir: string,
): Promise<{ repoPath: string; baseRef: string }> => {
  const repoPath = join(runDir, "repo");
  await mkdir(repoPath, { recursive: true });
  await cp(scenario.fixturePath, repoPath, { recursive: true });
  await Bun.$`git init -b main`.cwd(repoPath).quiet();
  await Bun.$`git config user.email "benchmark@aop.dev"`.cwd(repoPath).quiet();
  await Bun.$`git config user.name "AOP Benchmark"`.cwd(repoPath).quiet();
  await Bun.$`git add .`.cwd(repoPath).quiet();
  await Bun.$`git commit -m "Benchmark fixture"`.cwd(repoPath).quiet();
  const baseRef = (await Bun.$`git rev-parse HEAD`.cwd(repoPath).quiet()).stdout.toString().trim();
  return { repoPath, baseRef };
};

export const runCommand = async (
  command: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<BenchmarkVerificationResult> => {
  const proc = Bun.spawn({
    cmd: command,
    cwd,
    env: env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return {
    command,
    exitCode,
    stdout: await stdoutPromise,
    stderr: await stderrPromise,
  };
};

export const collectChangedFiles = async (repoPath: string, baseRef: string): Promise<string[]> => {
  const [committed, unstaged, staged, untracked] = await Promise.all([
    Bun.$`git diff --name-only ${baseRef}..HEAD`.cwd(repoPath).quiet(),
    Bun.$`git diff --name-only`.cwd(repoPath).quiet(),
    Bun.$`git diff --name-only --staged`.cwd(repoPath).quiet(),
    Bun.$`git ls-files --others --exclude-standard`.cwd(repoPath).quiet(),
  ]);

  return [
    committed.stdout.toString(),
    unstaged.stdout.toString(),
    staged.stdout.toString(),
    untracked.stdout.toString(),
  ]
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, lines) => lines.indexOf(line) === index)
    .sort();
};

export const writeBenchmarkResult = async (
  result: BenchmarkResult,
  runDir?: string,
): Promise<string> => {
  await mkdir(BENCHMARK_RESULTS_ROOT, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const fileName = `${result.scenario}-${result.mode}-${timestamp}.json`;
  const outputPath = join(runDir ?? BENCHMARK_RESULTS_ROOT, "result.json");
  const mirroredPath = join(BENCHMARK_RESULTS_ROOT, fileName);
  const serialized = JSON.stringify(result, null, 2);

  await writeFile(outputPath, serialized);
  await writeFile(mirroredPath, serialized);

  return outputPath;
};

export const resolveLatestBenchmarkResultPath = async (
  scenarioId: string,
  mode: BenchmarkMode,
): Promise<string | null> => {
  const entries = await readdir(BENCHMARK_RESULTS_ROOT, { withFileTypes: true }).catch(() => []);
  const matching = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${scenarioId}-${mode}-`))
    .sort((left, right) => right.name.localeCompare(left.name));

  return matching[0] ? join(BENCHMARK_RESULTS_ROOT, matching[0].name) : null;
};

export const loadBenchmarkResult = async (resultPath: string): Promise<BenchmarkResult> => {
  return JSON.parse(await readFile(resultPath, "utf-8")) as BenchmarkResult;
};

export const buildBenchmarkSummaryLines = (result: BenchmarkResult): string[] => [
  `${result.mode} benchmark: ${result.scenario}`,
  `- Success: ${result.success ? "yes" : "no"}`,
  `- Total duration: ${result.metrics.totalDurationMs}ms`,
  `- First task completed: ${
    result.metrics.firstTaskCompletedMs === null
      ? "n/a"
      : `${result.metrics.firstTaskCompletedMs}ms`
  }`,
  `- Max concurrent working tasks: ${result.metrics.maxConcurrentWorkingTasks}`,
  `- Tasks completed: ${result.metrics.tasksCompleted}/${result.metrics.tasksExpected}`,
  `- Final verification: ${result.metrics.finalVerificationPassed ? "pass" : "fail"}`,
  `- Unexpected changed files: ${
    result.unexpectedFilesChanged.length === 0 ? "none" : result.unexpectedFilesChanged.join(", ")
  }`,
  `- Missing required changed files: ${
    result.missingRequiredChangedFiles.length === 0
      ? "none"
      : result.missingRequiredChangedFiles.join(", ")
  }`,
  `- Result file: ${join(result.artifacts.runDir, "result.json")}`,
];

export const createScratchDir = async (prefix: string): Promise<string> => {
  return await mkdtemp(join(tmpdir(), `${prefix}-`));
};

const calculateImprovementPct = (baselineMs: number, candidateMs: number): number | null => {
  if (baselineMs <= 0) {
    return null;
  }
  return ((baselineMs - candidateMs) / baselineMs) * 100;
};
