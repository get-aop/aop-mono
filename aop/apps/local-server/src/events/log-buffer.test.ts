import { beforeEach, describe, expect, it } from "bun:test";
import {
  createLogBuffer,
  type ExecutionCompleteEvent,
  getLogBuffer,
  type LogBuffer,
  type LogEvent,
  type LogLine,
  resetLogBuffer,
} from "./log-buffer";

describe("LogBuffer", () => {
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = createLogBuffer();
  });

  const createLogLine = (content: string, stream: "stdout" | "stderr" = "stdout"): LogLine => ({
    stream,
    content,
    timestamp: new Date().toISOString(),
  });

  describe("push and getLines", () => {
    it("should store and retrieve log lines", () => {
      const line1 = createLogLine("line 1");
      const line2 = createLogLine("line 2");

      buffer.push("exec-1", line1);
      buffer.push("exec-1", line2);

      const lines = buffer.getLines("exec-1");
      expect(lines).toHaveLength(2);
      expect(lines[0]?.content).toBe("line 1");
      expect(lines[1]?.content).toBe("line 2");
    });

    it("should return empty array for unknown execution", () => {
      const lines = buffer.getLines("unknown");
      expect(lines).toEqual([]);
    });

    it("should keep lines separate per execution", () => {
      buffer.push("exec-1", createLogLine("exec1-line"));
      buffer.push("exec-2", createLogLine("exec2-line"));

      expect(buffer.getLines("exec-1")).toHaveLength(1);
      expect(buffer.getLines("exec-1")[0]?.content).toBe("exec1-line");
      expect(buffer.getLines("exec-2")).toHaveLength(1);
      expect(buffer.getLines("exec-2")[0]?.content).toBe("exec2-line");
    });

    it("should limit buffer to 500 lines", () => {
      for (let i = 0; i < 600; i++) {
        buffer.push("exec-1", createLogLine(`line ${i}`));
      }

      const lines = buffer.getLines("exec-1");
      expect(lines).toHaveLength(500);
      expect(lines[0]?.content).toBe("line 100");
      expect(lines[499]?.content).toBe("line 599");
    });
  });

  describe("subscribe", () => {
    it("should emit events when lines are pushed", () => {
      const events: LogEvent[] = [];
      buffer.subscribe((event) => events.push(event));

      const line = createLogLine("test");
      buffer.push("exec-1", line);

      expect(events).toHaveLength(1);
      expect(events[0]?.executionId).toBe("exec-1");
      expect(events[0]?.line.content).toBe("test");
    });

    it("should allow unsubscribing", () => {
      const events: LogEvent[] = [];
      const unsubscribe = buffer.subscribe((event) => events.push(event));

      buffer.push("exec-1", createLogLine("before"));
      unsubscribe();
      buffer.push("exec-1", createLogLine("after"));

      expect(events).toHaveLength(1);
    });
  });

  describe("completion tracking", () => {
    it("should track completion status", () => {
      expect(buffer.isComplete("exec-1")).toBe(false);
      expect(buffer.getStatus("exec-1")).toBeNull();

      buffer.markComplete("exec-1", "completed");

      expect(buffer.isComplete("exec-1")).toBe(true);
      expect(buffer.getStatus("exec-1")).toBe("completed");
    });

    it("should emit complete events", () => {
      const events: ExecutionCompleteEvent[] = [];
      buffer.subscribeComplete((event) => events.push(event));

      buffer.markComplete("exec-1", "failed");

      expect(events).toHaveLength(1);
      expect(events[0]?.executionId).toBe("exec-1");
      expect(events[0]?.status).toBe("failed");
    });
  });

  describe("clear", () => {
    it("should remove buffer and completion status", () => {
      buffer.push("exec-1", createLogLine("test"));
      buffer.markComplete("exec-1", "completed");

      buffer.clear("exec-1");

      expect(buffer.getLines("exec-1")).toEqual([]);
      expect(buffer.isComplete("exec-1")).toBe(false);
      expect(buffer.getStatus("exec-1")).toBeNull();
    });
  });

  describe("subscribeComplete", () => {
    it("should allow unsubscribing from complete events", () => {
      const events: ExecutionCompleteEvent[] = [];
      const unsubscribe = buffer.subscribeComplete((event) => events.push(event));

      buffer.markComplete("exec-1", "completed");
      unsubscribe();
      buffer.markComplete("exec-2", "failed");

      expect(events).toHaveLength(1);
      expect(events[0]?.executionId).toBe("exec-1");
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
    buffer1.push("exec-1", {
      stream: "stdout",
      content: "test",
      timestamp: new Date().toISOString(),
    });

    resetLogBuffer();

    const buffer2 = getLogBuffer();
    expect(buffer2.getLines("exec-1")).toEqual([]);
  });
});
