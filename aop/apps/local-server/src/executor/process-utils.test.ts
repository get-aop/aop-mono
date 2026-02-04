import { describe, expect, test } from "bun:test";
import { isProcessAlive } from "./process-utils.ts";

describe("isProcessAlive", () => {
  test("returns true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("returns false for non-existent process", () => {
    // Use a very high PID that's unlikely to exist
    expect(isProcessAlive(999999999)).toBe(false);
  });
});
