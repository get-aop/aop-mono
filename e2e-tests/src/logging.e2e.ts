import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import {
  configureLogging,
  getActiveTraceId,
  getLogger,
  initTracing,
  injectTraceHeaders,
  resetLogging,
  resetTracing,
  runWithSpan,
} from "@aop/infra";

const LOG_DIR = "tmp/e2e-logging-test";
const PRETTY_LOG = `${LOG_DIR}/app.log`;
const JSON_LOG = `${LOG_DIR}/app.jsonl`;

const SERVICE_COLORS: Record<string, string> = {
  server: "\x1b[32m",
  "local-server": "\x1b[33m",
  dashboard: "\x1b[35m",
  dev: "\x1b[36m",
  cli: "\x1b[34m",
};
const RESET = "\x1b[0m";

const parseJsonLines = async (path: string): Promise<Record<string, unknown>[]> => {
  const content = await Bun.file(path).text();
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const flush = async () => {
  await Bun.sleep(50);
  await resetLogging();
};

beforeEach(async () => {
  await resetLogging();
  resetTracing();
  if (existsSync(LOG_DIR)) rmSync(LOG_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
});

afterEach(async () => {
  await resetLogging();
  resetTracing();
});

describe("logging E2E", () => {
  describe("service name prefixes", () => {
    test("each service appears as [service] in pretty file output", async () => {
      for (const service of Object.keys(SERVICE_COLORS)) {
        if (existsSync(LOG_DIR)) rmSync(LOG_DIR, { recursive: true });
        mkdirSync(LOG_DIR, { recursive: true });

        await configureLogging({
          serviceName: service,
          sinks: { console: false, files: [{ path: PRETTY_LOG, format: "pretty" }] },
        });

        const logger = getLogger("test");
        logger.info(`Hello from ${service}`);

        await flush();

        const content = await Bun.file(PRETTY_LOG).text();
        expect(content).toContain(`[${service}]`);
        expect(content).toContain(`Hello from ${service}`);
      }
    });

    test("each service gets a distinct ANSI color code", () => {
      const colors = Object.values(SERVICE_COLORS);
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBe(colors.length);
    });

    test("console output uses ANSI colors for service prefix", async () => {
      const captured: string[] = [];
      // biome-ignore lint/suspicious/noConsole: testing console output behavior
      const origInfo = console.info;
      console.info = (...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      };

      try {
        await configureLogging({
          serviceName: "server",
          sinks: { console: true, files: [] },
        });

        const logger = getLogger("test");
        logger.info("Color check");

        await Bun.sleep(10);
      } finally {
        console.info = origInfo;
        await resetLogging();
      }

      const output = captured.join("\n");
      expect(output).toContain(`${SERVICE_COLORS.server}[server]${RESET}`);
    });
  });

  describe("JSON output attributes", () => {
    test("includes service, level, message, traceId, spanId, @timestamp, and custom props", async () => {
      initTracing("test-service");
      await configureLogging({
        serviceName: "local-server",
        sinks: { console: false, files: [{ path: JSON_LOG, format: "json" }] },
      });

      await runWithSpan("test-request", () => {
        const logger = getLogger("reconcile");
        logger.info("Reconciliation complete in {ms}ms", { ms: 4 });
      });

      await flush();

      const logs = await parseJsonLines(JSON_LOG);
      expect(logs).toHaveLength(1);

      const log = logs[0] as Record<string, unknown>;
      expect(log.service).toBe("local-server");
      expect(log.level).toBe("INFO");
      expect(log.message).toBe("Reconciliation complete in 4ms");
      expect(log.traceId).toHaveLength(32);
      expect(log.spanId).toHaveLength(16);
      expect(log.ms).toBe(4);
      expect(log["@timestamp"]).toBeDefined();
      expect(log.logger).toBe("reconcile");
    });

    test("omits traceId/spanId when no active span", async () => {
      await configureLogging({
        serviceName: "server",
        sinks: { console: false, files: [{ path: JSON_LOG, format: "json" }] },
      });

      const logger = getLogger("main");
      logger.info("No trace context");

      await flush();

      const logs = await parseJsonLines(JSON_LOG);
      expect(logs).toHaveLength(1);

      const log = logs[0] as Record<string, unknown>;
      expect(log.service).toBe("server");
      expect(log.traceId).toBeUndefined();
      expect(log.spanId).toBeUndefined();
    });
  });

  describe("trace context in pretty output", () => {
    test("shows abbreviated traceId as t:xxxxxxxx", async () => {
      initTracing("test-service");
      await configureLogging({
        serviceName: "local-server",
        sinks: { console: false, files: [{ path: PRETTY_LOG, format: "pretty" }] },
      });

      let capturedTraceId: string | undefined;
      await runWithSpan("test-span", () => {
        capturedTraceId = getActiveTraceId();
        const logger = getLogger("reconcile");
        logger.info("Traced message");
      });

      await flush();

      const content = await Bun.file(PRETTY_LOG).text();
      expect(content).toContain("[local-server]");
      expect(content).toMatch(/t:[a-f0-9]{8}/);
      expect(content).toContain(`t:${(capturedTraceId as string).slice(0, 8)}`);
      expect(content).toContain("Traced message");
    });
  });

  describe("trace propagation across services", () => {
    test("same traceId in logs when local-server → server share a trace", async () => {
      initTracing("e2e-trace-test");

      const localJsonLog = `${LOG_DIR}/local-server.jsonl`;
      const serverJsonLog = `${LOG_DIR}/server.jsonl`;

      // Phase 1: simulate local-server logging within a span and capturing trace headers
      await configureLogging({
        serviceName: "local-server",
        sinks: { console: false, files: [{ path: localJsonLog, format: "json" }] },
      });

      let propagatedTraceparent: string | undefined;
      let localTraceId: string | undefined;

      await runWithSpan("incoming-request", () => {
        localTraceId = getActiveTraceId();
        const logger = getLogger("orchestrator");
        logger.info("Processing request");
        const headers = injectTraceHeaders({});
        propagatedTraceparent = headers.get("traceparent") ?? undefined;
      });

      await Bun.sleep(50);
      await resetLogging();

      // Validate traceparent header was generated
      expect(propagatedTraceparent).toBeDefined();
      expect(propagatedTraceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[0-3]$/);
      const headerTraceId = (propagatedTraceparent as string).split("-")[1];
      expect(headerTraceId).toBe(localTraceId);

      // Phase 2: simulate server receiving the request with propagated trace context
      // Keep same OTel provider (in production they're separate processes, but the
      // W3C traceparent header carries the traceId across the boundary)
      await configureLogging({
        serviceName: "server",
        sinks: { console: false, files: [{ path: serverJsonLog, format: "json" }] },
      });

      // Extract trace context from the propagated traceparent using W3C propagator
      const { W3CTraceContextPropagator } = await import("@opentelemetry/core");
      const { context: otelContext } = await import("@opentelemetry/api");
      const propagator = new W3CTraceContextPropagator();

      const getter = {
        get: (carrier: Record<string, string>, key: string) => carrier[key],
        keys: (carrier: Record<string, string>) => Object.keys(carrier),
      };
      const extractedCtx = propagator.extract(
        otelContext.active(),
        { traceparent: propagatedTraceparent as string },
        getter,
      );

      await otelContext.with(extractedCtx, async () => {
        await runWithSpan("handle-request", () => {
          const logger = getLogger("workflow");
          logger.info("Step completed");
        });
      });

      await flush();

      // Validate both services logged with the same traceId
      const localLogs = await parseJsonLines(localJsonLog);
      const serverLogs = await parseJsonLines(serverJsonLog);

      expect(localLogs).toHaveLength(1);
      expect(serverLogs).toHaveLength(1);

      const localLog = localLogs[0] as Record<string, unknown>;
      const serverLog = serverLogs[0] as Record<string, unknown>;

      expect(localLog.service).toBe("local-server");
      expect(serverLog.service).toBe("server");

      // Both share the same traceId
      expect(localLog.traceId).toBe(localTraceId);
      expect(serverLog.traceId).toBe(localTraceId);

      // Different spanIds (different spans in the same trace)
      expect(localLog.spanId).toBeDefined();
      expect(serverLog.spanId).toBeDefined();
      expect(localLog.spanId).not.toBe(serverLog.spanId);
    });
  });

  describe("dual format output", () => {
    test("both pretty and JSON sinks write simultaneously", async () => {
      initTracing("test-service");
      await configureLogging({
        serviceName: "local-server",
        sinks: {
          console: false,
          files: [
            { path: PRETTY_LOG, format: "pretty" },
            { path: JSON_LOG, format: "json" },
          ],
        },
      });

      await runWithSpan("dual-output", () => {
        const logger = getLogger("reconcile");
        logger.info("Dual sink message", { key: "value" });
        logger.warn("Warning message", { count: 42 });
      });

      await flush();

      // Validate pretty output
      const prettyContent = await Bun.file(PRETTY_LOG).text();
      expect(prettyContent).toContain("[local-server]");
      expect(prettyContent).toMatch(/t:[a-f0-9]{8}/);
      expect(prettyContent).toContain("Dual sink message");
      expect(prettyContent).toContain("Warning message");

      // Validate JSON output
      const jsonLogs = await parseJsonLines(JSON_LOG);
      expect(jsonLogs).toHaveLength(2);

      const infoLog = jsonLogs[0] as Record<string, unknown>;
      const warnLog = jsonLogs[1] as Record<string, unknown>;
      expect(infoLog.service).toBe("local-server");
      expect(infoLog.level).toBe("INFO");
      expect(infoLog.message).toBe("Dual sink message");
      expect(infoLog.key).toBe("value");
      expect(infoLog.traceId).toBeDefined();
      expect(infoLog.spanId).toBeDefined();

      expect(warnLog.service).toBe("local-server");
      expect(warnLog.level).toBe("WARN");
      expect(warnLog.message).toBe("Warning message");
      expect(warnLog.count).toBe(42);

      // Same trace context for both logs
      expect(infoLog.traceId).toBe(warnLog.traceId);
    });
  });
});
