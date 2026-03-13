import { buildBenchmarkSummaryLines } from "./benchmark/shared.ts";
import { parseScenarioArg, runAopCodexBenchmark } from "./run-aop-codex-benchmark.ts";

export { parseScenarioArg };

const run = async (): Promise<void> => {
  const scenarioId = parseScenarioArg(process.argv.slice(2));
  const result = await runAopCodexBenchmark(scenarioId);
  process.stdout.write(`${buildBenchmarkSummaryLines(result).join("\n")}\n`);
};

if (import.meta.main) {
  await run();
}
