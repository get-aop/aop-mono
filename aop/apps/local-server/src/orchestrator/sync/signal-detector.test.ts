import { describe, expect, test } from "bun:test";
import { detectSignal } from "./signal-detector.ts";

describe("detectSignal", () => {
  test("returns undefined when output is empty", () => {
    const result = detectSignal("", ["PAUSE", "DONE"]);

    expect(result.signal).toBeUndefined();
    expect(result.position).toBeUndefined();
  });

  test("returns undefined when signals array is empty", () => {
    const result = detectSignal("some output with <aop>PAUSE</aop>", []);

    expect(result.signal).toBeUndefined();
    expect(result.position).toBeUndefined();
  });

  test("returns undefined when no signal found", () => {
    const result = detectSignal("some output without signals", ["PAUSE", "DONE"]);

    expect(result.signal).toBeUndefined();
    expect(result.position).toBeUndefined();
  });

  test("detects signal wrapped in aop tags", () => {
    const result = detectSignal("output with <aop>PAUSE</aop> here", ["PAUSE", "DONE"]);

    expect(result.signal).toBe("PAUSE");
    expect(result.position).toBe(12);
  });

  test("returns earliest signal when multiple signals present", () => {
    const result = detectSignal("first <aop>DONE</aop> and then <aop>PAUSE</aop>", [
      "PAUSE",
      "DONE",
    ]);

    expect(result.signal).toBe("DONE");
    expect(result.position).toBe(6);
  });

  test("ignores signals not wrapped in aop tags", () => {
    const result = detectSignal("PAUSE without tags <aop>DONE</aop>", ["PAUSE", "DONE"]);

    expect(result.signal).toBe("DONE");
    expect(result.position).toBe(19);
  });

  test("ignores partial tag matches", () => {
    const result = detectSignal("<aopPAUSE</aop> <aop>DONE</aop>", ["PAUSE", "DONE"]);

    expect(result.signal).toBe("DONE");
  });
});
