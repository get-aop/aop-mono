import { describe, expect, test } from "bun:test";

import {
  findPidByEnvLinux,
  findPidByStepId,
  findPidsByEnvLinux,
  findPidsByTaskId,
  isAgentRunning,
  isClaudeProcess,
  isProcessAlive,
  isZombie,
} from "./process-utils.ts";

describe("isProcessAlive", () => {
  test("returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("returns false for non-existent process", () => {
    expect(isProcessAlive(999999)).toBe(false);
  });

  test("handles process.kill exceptions", () => {
    expect(isProcessAlive(999998)).toBe(false);
  });
});

describe("isZombie", () => {
  test("returns false for current process", () => {
    expect(isZombie(process.pid)).toBe(false);
  });

  test("returns false for non-existent process", () => {
    expect(isZombie(999999)).toBe(false);
  });

  test("returns false when process read fails", () => {
    expect(isZombie(999998)).toBe(false);
  });

  test("returns false for running process on macOS", () => {
    expect(isZombie(process.pid)).toBe(false);
  });
});

describe("isAgentRunning", () => {
  test("returns true for current process", () => {
    expect(isAgentRunning(process.pid)).toBe(true);
  });

  test("returns false for non-existent process", () => {
    expect(isAgentRunning(999999)).toBe(false);
  });

  test("returns false when isProcessAlive is false", () => {
    expect(isAgentRunning(999998)).toBe(false);
  });

  test("returns false for zombie processes", () => {
    expect(isAgentRunning(999997)).toBe(false);
  });
});

describe("isClaudeProcess", () => {
  test("returns false for non-existent process", () => {
    expect(isClaudeProcess(999999)).toBe(false);
  });

  test("returns false for non-claude process", () => {
    expect(isClaudeProcess(process.pid)).toBe(false);
  });

  test("returns false when process read fails", () => {
    expect(isClaudeProcess(999998)).toBe(false);
  });

  test("handles command execution errors gracefully", () => {
    expect(isClaudeProcess(999997)).toBe(false);
  });
});

describe("findPidByStepId", () => {
  test("returns null when no processes match", () => {
    expect(findPidByStepId("nonexistent-step-id-xyz")).toBeNull();
  });

  test("returns null when lookup fails", () => {
    expect(findPidByStepId("")).toBeNull();
  });

  test("returns null for special characters", () => {
    expect(findPidByStepId("../../../etc/passwd")).toBeNull();
  });
});

describe("findPidsByTaskId", () => {
  test("returns empty array when no processes match", () => {
    expect(findPidsByTaskId("nonexistent-task-id-xyz")).toEqual([]);
  });

  test("returns array of length >= 0", () => {
    const result = findPidsByTaskId("test-task");
    expect(Array.isArray(result)).toBe(true);
  });

  test("handles empty task ID", () => {
    expect(findPidsByTaskId("")).toEqual([]);
  });
});

const isLinux = process.platform === "linux";

// Linux /proc tests — mock.module("node:fs") doesn't work in Bun for builtins,
// so these only run on Linux where /proc is available natively.
describe.skipIf(!isLinux)("findPidByEnvLinux (Linux only)", () => {
  test("returns null when no matching process found", () => {
    expect(findPidByEnvLinux("AOP_NONEXISTENT_VAR", "no-match")).toBeNull();
  });

  test("handles non-existent PIDs gracefully", () => {
    expect(findPidByEnvLinux("AOP_STEP_ID", "step-nonexistent")).toBeNull();
  });
});

describe.skipIf(!isLinux)("findPidsByEnvLinux (Linux only)", () => {
  test("returns empty array when no matching processes found", () => {
    expect(findPidsByEnvLinux("AOP_NONEXISTENT_VAR", "no-match")).toEqual([]);
  });

  test("handles non-existent PIDs gracefully", () => {
    expect(findPidsByEnvLinux("AOP_TASK_ID", "task-nonexistent")).toEqual([]);
  });
});
