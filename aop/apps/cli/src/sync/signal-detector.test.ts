import { describe, expect, it } from "bun:test";
import { detectSignal } from "./signal-detector.ts";

describe("detectSignal", () => {
  it("returns undefined when output is empty", () => {
    const result = detectSignal("", ["TASK_COMPLETE", "NEEDS_REVIEW"]);
    expect(result.signal).toBeUndefined();
    expect(result.position).toBeUndefined();
  });

  it("returns undefined when signals array is empty", () => {
    const result = detectSignal("<aop>TASK_COMPLETE</aop>", []);
    expect(result.signal).toBeUndefined();
    expect(result.position).toBeUndefined();
  });

  it("returns undefined when no signal is found", () => {
    const result = detectSignal("Some output without signals", ["TASK_COMPLETE", "NEEDS_REVIEW"]);
    expect(result.signal).toBeUndefined();
    expect(result.position).toBeUndefined();
  });

  it("detects a signal in aop tags", () => {
    const output = "Working on the task...\n<aop>TASK_COMPLETE</aop>\nDone!";
    const result = detectSignal(output, ["TASK_COMPLETE", "NEEDS_REVIEW"]);
    expect(result.signal).toBe("TASK_COMPLETE");
    expect(result.position).toBe(23);
  });

  it("detects the first signal when multiple are present", () => {
    const output = "First <aop>NEEDS_REVIEW</aop> then <aop>TASK_COMPLETE</aop>";
    const result = detectSignal(output, ["TASK_COMPLETE", "NEEDS_REVIEW"]);
    expect(result.signal).toBe("NEEDS_REVIEW");
    expect(result.position).toBe(6);
  });

  it("returns the earliest match regardless of signal order in array", () => {
    const output = "First <aop>TASK_COMPLETE</aop> then <aop>NEEDS_REVIEW</aop>";
    const result = detectSignal(output, ["NEEDS_REVIEW", "TASK_COMPLETE"]);
    expect(result.signal).toBe("TASK_COMPLETE");
    expect(result.position).toBe(6);
  });

  it("does not match partial signals", () => {
    const output = "This is TASK_COMPLETE but not in tags";
    const result = detectSignal(output, ["TASK_COMPLETE"]);
    expect(result.signal).toBeUndefined();
  });

  it("does not match signals with wrong tag format", () => {
    const output = "<aop>TASK_COMPLETE</aap> or [aop]TASK_COMPLETE[/aop]";
    const result = detectSignal(output, ["TASK_COMPLETE"]);
    expect(result.signal).toBeUndefined();
  });

  it("handles signals with underscores and numbers", () => {
    const output = "<aop>STEP_2_DONE</aop>";
    const result = detectSignal(output, ["STEP_1_DONE", "STEP_2_DONE"]);
    expect(result.signal).toBe("STEP_2_DONE");
  });

  it("is case sensitive", () => {
    const output = "<aop>task_complete</aop>";
    const result = detectSignal(output, ["TASK_COMPLETE"]);
    expect(result.signal).toBeUndefined();
  });

  it("handles signal at the beginning of output", () => {
    const output = "<aop>TASK_COMPLETE</aop> Task is done";
    const result = detectSignal(output, ["TASK_COMPLETE"]);
    expect(result.signal).toBe("TASK_COMPLETE");
    expect(result.position).toBe(0);
  });

  it("handles signal at the end of output", () => {
    const output = "Task is done <aop>TASK_COMPLETE</aop>";
    const result = detectSignal(output, ["TASK_COMPLETE"]);
    expect(result.signal).toBe("TASK_COMPLETE");
    expect(result.position).toBe(13);
  });
});
