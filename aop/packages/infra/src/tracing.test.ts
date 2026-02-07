import { afterEach, describe, expect, test } from "bun:test";
import {
  getActiveSpanId,
  getActiveTraceId,
  getTracer,
  initTracing,
  injectTraceHeaders,
  resetTracing,
  runWithSpan,
} from "./tracing.ts";

afterEach(() => {
  resetTracing();
});

describe("initTracing", () => {
  test("initializes a tracer provider for the given service", () => {
    const provider = initTracing("test-service");
    expect(provider).toBeDefined();
  });

  test("returns the same provider on repeated calls", () => {
    const first = initTracing("test-service");
    const second = initTracing("test-service");
    expect(first).toBe(second);
  });
});

describe("getTracer", () => {
  test("returns a tracer after initialization", () => {
    initTracing("test-service");
    const tracer = getTracer();
    expect(tracer).toBeDefined();
  });

  test("returns a no-op tracer before initialization", () => {
    const tracer = getTracer();
    expect(tracer).toBeDefined();
  });
});

describe("getActiveTraceId / getActiveSpanId", () => {
  test("returns undefined when no span is active", () => {
    expect(getActiveTraceId()).toBeUndefined();
    expect(getActiveSpanId()).toBeUndefined();
  });

  test("returns trace/span IDs inside an active span", () => {
    initTracing("test-service");
    const tracer = getTracer();

    tracer.startActiveSpan("test-span", (span) => {
      const traceId = getActiveTraceId();
      const spanId = getActiveSpanId();

      expect(traceId).toBeDefined();
      expect(traceId).toHaveLength(32);
      expect(spanId).toBeDefined();
      expect(spanId).toHaveLength(16);

      span.end();
    });
  });

  test("returns undefined after span ends and context exits", () => {
    initTracing("test-service");
    const tracer = getTracer();

    tracer.startActiveSpan("test-span", (span) => {
      span.end();
    });

    expect(getActiveTraceId()).toBeUndefined();
    expect(getActiveSpanId()).toBeUndefined();
  });
});

describe("injectTraceHeaders", () => {
  test("returns headers unchanged when no span is active", () => {
    const headers = new Headers({ "content-type": "application/json" });
    const result = injectTraceHeaders(headers);
    expect(result.get("content-type")).toBe("application/json");
    expect(result.has("traceparent")).toBe(false);
  });

  test("injects traceparent header when span is active", () => {
    initTracing("test-service");
    const tracer = getTracer();

    tracer.startActiveSpan("test-span", (span) => {
      const headers = new Headers();
      const result = injectTraceHeaders(headers);

      expect(result.has("traceparent")).toBe(true);
      const traceparent = result.get("traceparent") ?? "";
      expect(traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[0-3]$/);

      span.end();
    });
  });

  test("works with plain object headers", () => {
    initTracing("test-service");
    const tracer = getTracer();

    tracer.startActiveSpan("test-span", (span) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const result = injectTraceHeaders(headers);

      expect(result.get("traceparent")).toBeDefined();
      expect(result.get("content-type")).toBe("application/json");

      span.end();
    });
  });
});

describe("runWithSpan", () => {
  test("executes function within a span context", async () => {
    initTracing("test-service");
    let capturedTraceId: string | undefined;

    await runWithSpan("test-operation", () => {
      capturedTraceId = getActiveTraceId();
    });

    expect(capturedTraceId).toBeDefined();
    expect(capturedTraceId).toHaveLength(32);
  });

  test("returns the function result", async () => {
    initTracing("test-service");
    const result = await runWithSpan("test-op", () => 42);
    expect(result).toBe(42);
  });

  test("returns async function result", async () => {
    initTracing("test-service");
    const result = await runWithSpan("test-op", async () => {
      await Bun.sleep(1);
      return "async-result";
    });
    expect(result).toBe("async-result");
  });

  test("records error on span when function throws", async () => {
    initTracing("test-service");
    await expect(
      runWithSpan("test-op", () => {
        throw new Error("test error");
      }),
    ).rejects.toThrow("test error");
  });

  test("trace context is not active after runWithSpan completes", async () => {
    initTracing("test-service");
    await runWithSpan("test-op", () => {
      expect(getActiveTraceId()).toBeDefined();
    });
    expect(getActiveTraceId()).toBeUndefined();
  });
});
