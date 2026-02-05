import { describe, expect, mock, test } from "bun:test";
import type { SSEStreamingApi } from "hono/streaming";
import { createSSEStreamHelper } from "./sse-stream.ts";

const createMockStream = (options?: { failOnWrite?: boolean }) => {
  const written: { data: string; event: string; id: string }[] = [];
  let abortCallback: (() => void) | null = null;

  return {
    stream: {
      writeSSE: mock(async (event: { data: string; event: string; id: string }) => {
        if (options?.failOnWrite) {
          throw new Error("Connection closed");
        }
        written.push(event);
      }),
      onAbort: (callback: () => void) => {
        abortCallback = callback;
      },
    } as unknown as SSEStreamingApi,
    written,
    triggerAbort: () => abortCallback?.(),
  };
};

describe("sse-stream", () => {
  test("sendEvent serializes data as JSON and increments event ID", async () => {
    const { stream, written } = createMockStream();
    const sse = createSSEStreamHelper(stream);

    const result1 = await sse.sendEvent("test", { foo: "bar" });
    const result2 = await sse.sendEvent("test", { baz: 123 });

    expect(result1).toBe(true);
    expect(result2).toBe(true);
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual({ data: '{"foo":"bar"}', event: "test", id: "0" });
    expect(written[1]).toEqual({ data: '{"baz":123}', event: "test", id: "1" });
  });

  test("sendRaw sends data without JSON serialization", async () => {
    const { stream, written } = createMockStream();
    const sse = createSSEStreamHelper(stream);

    const result = await sse.sendRaw("heartbeat", "");

    expect(result).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual({ data: "", event: "heartbeat", id: "0" });
  });

  test("sendEvent returns false and triggers cleanup on write failure", async () => {
    const { stream } = createMockStream({ failOnWrite: true });
    const sse = createSSEStreamHelper(stream);

    const cleanup = mock(() => {});
    sse.registerCleanup(cleanup);

    const result = await sse.sendEvent("test", { foo: "bar" });

    expect(result).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(sse.isCleanedUp()).toBe(true);
  });

  test("sendEvent returns false without throwing when already cleaned up", async () => {
    const { stream, written } = createMockStream();
    const sse = createSSEStreamHelper(stream);

    sse.runCleanup();
    const result = await sse.sendEvent("test", { foo: "bar" });

    expect(result).toBe(false);
    expect(written).toHaveLength(0);
  });

  test("registerCleanup and runCleanup execute registered functions", () => {
    const { stream } = createMockStream();
    const sse = createSSEStreamHelper(stream);

    const cleanup1 = mock(() => {});
    const cleanup2 = mock(() => {});

    sse.registerCleanup(cleanup1);
    sse.registerCleanup(cleanup2);

    expect(cleanup1).not.toHaveBeenCalled();
    expect(cleanup2).not.toHaveBeenCalled();

    sse.runCleanup();

    expect(cleanup1).toHaveBeenCalledTimes(1);
    expect(cleanup2).toHaveBeenCalledTimes(1);
  });

  test("runCleanup only executes once", () => {
    const { stream } = createMockStream();
    const sse = createSSEStreamHelper(stream);

    const cleanup = mock(() => {});
    sse.registerCleanup(cleanup);

    sse.runCleanup();
    sse.runCleanup();
    sse.runCleanup();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test("onAbort triggers cleanup", () => {
    const { stream, triggerAbort } = createMockStream();
    const sse = createSSEStreamHelper(stream);

    const cleanup = mock(() => {});
    sse.registerCleanup(cleanup);

    triggerAbort();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(sse.isCleanedUp()).toBe(true);
  });

  test("isCleanedUp returns correct state", () => {
    const { stream } = createMockStream();
    const sse = createSSEStreamHelper(stream);

    expect(sse.isCleanedUp()).toBe(false);
    sse.runCleanup();
    expect(sse.isCleanedUp()).toBe(true);
  });
});
