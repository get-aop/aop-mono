import { describe, expect, test } from "bun:test";
import { parseScenarioArg } from "./run-aop-codex-benchmark.ts";

describe("run-aop-codex-benchmark", () => {
  test("parseScenarioArg reads explicit scenario overrides", () => {
    expect(parseScenarioArg(["--scenario=notes-cli"])).toBe("notes-cli");
  });
});
