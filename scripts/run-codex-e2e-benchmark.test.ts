import { describe, expect, test } from "bun:test";
import { parseScenarioArg } from "./run-codex-e2e-benchmark.ts";

describe("run-codex-e2e-benchmark", () => {
  test("delegates scenario parsing to the AOP Codex benchmark runner", () => {
    expect(parseScenarioArg(["--scenario=notes-cli"])).toBe("notes-cli");
  });
});
