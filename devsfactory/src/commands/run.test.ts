import { describe, expect, test } from "bun:test";
import { parseRunArgs } from "./run";

describe("parseRunArgs", () => {
  test("returns empty args when no arguments provided", () => {
    const result = parseRunArgs([]);
    expect(result.help).toBe(false);
    expect(result.stop).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("returns help flag when -h is provided", () => {
    const result = parseRunArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("returns help flag when --help is provided", () => {
    const result = parseRunArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("returns stop flag when stop is provided", () => {
    const result = parseRunArgs(["stop"]);
    expect(result.stop).toBe(true);
  });

  test("returns stop flag when --stop is provided", () => {
    const result = parseRunArgs(["--stop"]);
    expect(result.stop).toBe(true);
  });

  test("returns status flag when status is provided", () => {
    const result = parseRunArgs(["status"]);
    expect(result.status).toBe(true);
  });

  test("returns status flag when --status is provided", () => {
    const result = parseRunArgs(["--status"]);
    expect(result.status).toBe(true);
  });

  test("returns error for unknown option", () => {
    const result = parseRunArgs(["--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });
});
