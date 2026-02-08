import { describe, expect, test } from "bun:test";
import { isClaudeProcess, isProcessAlive } from "./process-utils.ts";

describe("isProcessAlive", () => {
  test("returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("returns false for non-existent process", () => {
    expect(isProcessAlive(999999999)).toBe(false);
  });
});

describe("isClaudeProcess", () => {
  test("returns false for non-existent process", () => {
    expect(isClaudeProcess(999999999)).toBe(false);
  });

  test("returns false for non-claude process", () => {
    expect(isClaudeProcess(process.pid)).toBe(false);
  });
});
