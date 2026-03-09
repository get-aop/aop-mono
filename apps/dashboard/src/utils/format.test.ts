import { describe, expect, test } from "bun:test";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  test("returns milliseconds for sub-second durations", () => {
    const start = "2024-01-01T00:00:00.000Z";
    const end = "2024-01-01T00:00:00.450Z";
    expect(formatDuration(start, end)).toBe("450ms");
  });

  test("returns seconds for durations under 60s", () => {
    const start = "2024-01-01T00:00:00.000Z";
    const end = "2024-01-01T00:00:45.000Z";
    expect(formatDuration(start, end)).toBe("45s");
  });

  test("returns minutes and seconds for durations >= 60s", () => {
    const start = "2024-01-01T00:00:00.000Z";
    const end = "2024-01-01T00:12:34.000Z";
    expect(formatDuration(start, end)).toBe("12m 34s");
  });

  test("clamps negative duration to 0ms", () => {
    const start = "2024-01-01T00:00:01.000Z";
    const end = "2024-01-01T00:00:00.000Z";
    expect(formatDuration(start, end)).toBe("0ms");
  });

  test("shows 1m 0s at exactly 60 seconds", () => {
    const start = "2024-01-01T00:00:00.000Z";
    const end = "2024-01-01T00:01:00.000Z";
    expect(formatDuration(start, end)).toBe("1m 0s");
  });
});
