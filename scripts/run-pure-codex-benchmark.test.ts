import { describe, expect, test } from "bun:test";
import { buildPureCodexBenchmarkPrompt, parseScenarioArg } from "./run-pure-codex-benchmark.ts";

describe("run-pure-codex-benchmark", () => {
  test("buildPureCodexBenchmarkPrompt includes benchmark rules", () => {
    const prompt = buildPureCodexBenchmarkPrompt("notes-cli");

    expect(prompt).toContain("Respect task dependencies");
    expect(prompt).toContain("update its task.md status to WORKING");
    expect(prompt).toContain("Run `bun test`");
  });

  test("parseScenarioArg reads explicit scenario overrides", () => {
    expect(parseScenarioArg(["--scenario=notes-cli"])).toBe("notes-cli");
  });
});
