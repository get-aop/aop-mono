import {
  loadBenchmarkResult,
  resolveLatestBenchmarkResultPath,
  summarizeBenchmarkComparison,
} from "./benchmark/shared.ts";

const DEFAULT_SCENARIO = "notes-cli";

const formatPct = (value: number | null): string =>
  value === null ? "n/a" : `${value.toFixed(2)}%`;

const run = async (): Promise<void> => {
  const scenarioId =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--scenario="))
      ?.split("=")[1]
      ?.trim() || DEFAULT_SCENARIO;
  const aopPath = await resolveLatestBenchmarkResultPath(scenarioId, "aop-codex");
  const purePath = await resolveLatestBenchmarkResultPath(scenarioId, "pure-codex");

  if (!aopPath || !purePath) {
    throw new Error(
      `Missing benchmark results for scenario "${scenarioId}". Run both the AOP and pure Codex benchmarks first.`,
    );
  }

  const aopResult = await loadBenchmarkResult(aopPath);
  const pureResult = await loadBenchmarkResult(purePath);
  const comparison = summarizeBenchmarkComparison(aopResult, pureResult);

  const lines = [
    `Scenario: ${comparison.scenario}`,
    `- AOP total duration delta: ${comparison.totalDurationDeltaMs}ms`,
    `- AOP total duration improvement: ${formatPct(comparison.totalDurationImprovementPct)}`,
    `- AOP first completion delta: ${
      comparison.firstCompletionDeltaMs === null ? "n/a" : `${comparison.firstCompletionDeltaMs}ms`
    }`,
    `- AOP first completion improvement: ${formatPct(comparison.firstCompletionImprovementPct)}`,
    `- AOP max concurrency: ${aopResult.metrics.maxConcurrentWorkingTasks}`,
    `- Pure Codex max concurrency: ${pureResult.metrics.maxConcurrentWorkingTasks}`,
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
};

if (import.meta.main) {
  await run();
}
