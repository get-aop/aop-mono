import { beforeEach, describe, expect, it } from "bun:test";
import {
  createLogBuffer,
  getLogBuffer,
  type LogBuffer,
  type LogEvent,
  resetLogBuffer,
  type StepCompleteEvent,
} from "./log-buffer";

describe("LogBuffer", () => {
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = createLogBuffer();
  });

  describe("push and getLines", () => {
    it("should store and retrieve log lines", () => {
      buffer.push("step-1", '{"type":"text","content":"line 1"}');
      buffer.push("step-1", '{"type":"text","content":"line 2"}');

      const lines = buffer.getLines("step-1");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('{"type":"text","content":"line 1"}');
      expect(lines[1]).toBe('{"type":"text","content":"line 2"}');
    });

    it("should return empty array for unknown step execution", () => {
      const lines = buffer.getLines("unknown");
      expect(lines).toEqual([]);
    });

    it("should keep lines separate per step execution", () => {
      buffer.push("step-1", "step1-line");
      buffer.push("step-2", "step2-line");

      expect(buffer.getLines("step-1")).toHaveLength(1);
      expect(buffer.getLines("step-1")[0]).toBe("step1-line");
      expect(buffer.getLines("step-2")).toHaveLength(1);
      expect(buffer.getLines("step-2")[0]).toBe("step2-line");
    });

    it("should limit buffer to 500 lines", () => {
      for (let i = 0; i < 600; i++) {
        buffer.push("step-1", `line ${i}`);
      }

      const lines = buffer.getLines("step-1");
      expect(lines).toHaveLength(500);
      expect(lines[0]).toBe("line 100");
      expect(lines[499]).toBe("line 599");
    });
  });

  describe("subscribe", () => {
    it("should emit events when lines are pushed", () => {
      const events: LogEvent[] = [];
      buffer.subscribe((event) => events.push(event));

      buffer.push("step-1", "test line");

      expect(events).toHaveLength(1);
      expect(events[0]?.stepExecutionId).toBe("step-1");
      expect(events[0]?.line).toBe("test line");
    });

    it("should allow unsubscribing", () => {
      const events: LogEvent[] = [];
      const unsubscribe = buffer.subscribe((event) => events.push(event));

      buffer.push("step-1", "before");
      unsubscribe();
      buffer.push("step-1", "after");

      expect(events).toHaveLength(1);
    });
  });

  describe("completion tracking", () => {
    it("should track completion status", () => {
      expect(buffer.isComplete("step-1")).toBe(false);
      expect(buffer.getStatus("step-1")).toBeNull();

      buffer.markComplete("step-1", "completed");

      expect(buffer.isComplete("step-1")).toBe(true);
      expect(buffer.getStatus("step-1")).toBe("completed");
    });

    it("should emit complete events", () => {
      const events: StepCompleteEvent[] = [];
      buffer.subscribeComplete((event) => events.push(event));

      buffer.markComplete("step-1", "failed");

      expect(events).toHaveLength(1);
      expect(events[0]?.stepExecutionId).toBe("step-1");
      expect(events[0]?.status).toBe("failed");
    });
  });

  describe("clear", () => {
    it("should remove buffer and completion status", () => {
      buffer.push("step-1", "test");
      buffer.markComplete("step-1", "completed");

      buffer.clear("step-1");

      expect(buffer.getLines("step-1")).toEqual([]);
      expect(buffer.isComplete("step-1")).toBe(false);
      expect(buffer.getStatus("step-1")).toBeNull();
    });
  });

  describe("subscribeComplete", () => {
    it("should allow unsubscribing from complete events", () => {
      const events: StepCompleteEvent[] = [];
      const unsubscribe = buffer.subscribeComplete((event) => events.push(event));

      buffer.markComplete("step-1", "completed");
      unsubscribe();
      buffer.markComplete("step-2", "failed");

      expect(events).toHaveLength(1);
      expect(events[0]?.stepExecutionId).toBe("step-1");
    });
  });
});

describe("getLogBuffer / resetLogBuffer", () => {
  beforeEach(() => {
    resetLogBuffer();
  });

  it("should return a singleton instance", () => {
    const buffer1 = getLogBuffer();
    const buffer2 = getLogBuffer();
    expect(buffer1).toBe(buffer2);
  });

  it("should return a new instance after reset", () => {
    const buffer1 = getLogBuffer();
    buffer1.push("step-1", "test");

    resetLogBuffer();

    const buffer2 = getLogBuffer();
    expect(buffer2.getLines("step-1")).toEqual([]);
  });
});
