import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { configureLogging, getLogger, resetLogging } from "./logger.ts";

const TEST_LOG_DIR = "tmp/aop-logger-test";
const PRETTY_LOG_PATH = `${TEST_LOG_DIR}/app.log`;
const JSON_LOG_PATH = `${TEST_LOG_DIR}/app.jsonl`;

afterEach(async () => {
  await resetLogging();
});

describe("getLogger", () => {
  test("returns a logger for the given category", () => {
    const logger = getLogger("aop", "orchestrator");
    expect(logger).toBeDefined();
    expect(logger.category).toEqual(["aop", "orchestrator"]);
  });

  test("logger works without configuration (no-op)", () => {
    const logger = getLogger("aop", "test");
    expect(() => logger.info("test message")).not.toThrow();
  });
});

describe("configureLogging", () => {
  test("configures with default options", async () => {
    await expect(configureLogging()).resolves.toBeUndefined();
  });

  test("configures with custom level", async () => {
    await expect(configureLogging({ level: "info" })).resolves.toBeUndefined();
  });

  test("configures with console sink disabled", async () => {
    await expect(configureLogging({ sinks: { console: false } })).resolves.toBeUndefined();
  });

  test("can reconfigure multiple times", async () => {
    await configureLogging({ level: "debug" });
    await expect(configureLogging({ level: "info" })).resolves.toBeUndefined();
  });

  test("logger emits after configuration", async () => {
    await configureLogging();
    const logger = getLogger("aop", "orchestrator");

    expect(() =>
      logger.info("Task {taskId} assigned to agent {agentId}", {
        taskId: "task-7f3a",
        agentId: "agent-12",
        userId: "user-456",
      }),
    ).not.toThrow();

    expect(() =>
      logger.debug("Agent state transition: {from} -> {to}", {
        agentId: "agent-12",
        from: "idle",
        to: "executing",
        taskId: "task-7f3a",
      }),
    ).not.toThrow();

    expect(() =>
      logger.warn("Task execution exceeded timeout threshold", {
        taskId: "task-7f3a",
        elapsed: 45000,
        threshold: 30000,
      }),
    ).not.toThrow();

    expect(() =>
      logger.info("Agent completed task with result: {result}", {
        taskId: "task-7f3a",
        agentId: "agent-12",
        result: {
          status: "success",
          output: { filesCreated: ["src/index.ts", "src/utils.ts"], linesAdded: 142 },
          metrics: { duration: 12500, tokensUsed: 4200 },
        },
      }),
    ).not.toThrow();

    const error = new Error("Connection refused");
    expect(() =>
      logger.error("Failed to connect to MCP server: {error}", {
        server: "localhost:8080",
        retryCount: 3,
        error,
      }),
    ).not.toThrow();
  });

  test("configures with json format for servers", async () => {
    await configureLogging({ format: "json" });
    const logger = getLogger("aop", "server");

    expect(() =>
      logger.info("HTTP server listening on port {port}", {
        port: 3000,
        env: "production",
        version: "1.2.0",
      }),
    ).not.toThrow();

    const error = new Error("ECONNREFUSED");
    error.stack = `Error: ECONNREFUSED
    at Database.connect (db.ts:42:11)
    at async Server.start (server.ts:15:5)`;
    expect(() =>
      logger.error("Database connection failed: {error}", {
        host: "db.example.com",
        port: 5432,
        database: "aop",
        error,
      }),
    ).not.toThrow();
  });
});

describe("file sinks", () => {
  beforeEach(async () => {
    await resetLogging();
    if (existsSync(TEST_LOG_DIR)) {
      rmSync(TEST_LOG_DIR, { recursive: true });
    }
    mkdirSync(TEST_LOG_DIR, { recursive: true });
  });

  test("writes logs to pretty formatted file", async () => {
    await configureLogging({
      level: "info",
      sinks: {
        console: true,
        files: [{ path: PRETTY_LOG_PATH, format: "pretty" }],
      },
    });

    const logger = getLogger("aop", "test");
    logger.info("Test message {id} {logPath}", { id: 123, logPath: PRETTY_LOG_PATH });
    logger.warn("Warning message");

    // Give time for async writes to complete
    await Bun.sleep(50);
    await resetLogging();

    const content = await Bun.file(PRETTY_LOG_PATH).text();
    expect(content).toContain("Test message 123");
    expect(content).toContain("Warning message");
    expect(content).toContain("aop·test");
  });

  test("writes logs to JSONL formatted file", async () => {
    await configureLogging({
      level: "debug",
      sinks: {
        console: false,
        files: [{ path: JSON_LOG_PATH, format: "json" }],
      },
    });

    const logger = getLogger("aop", "orchestrator");
    logger.info("Task started", { taskId: "task-001", agentId: "agent-01" });
    logger.debug("Processing step", { step: 1, total: 3 });

    await Bun.sleep(50);
    await resetLogging();

    const content = await Bun.file(JSON_LOG_PATH).text();
    const lines = content.trim().split("\n").filter(Boolean);

    expect(lines.length).toBe(2);

    const [firstLine, secondLine] = lines;
    const firstLog = JSON.parse(firstLine as string);
    expect(firstLog.level).toBe("INFO");
    expect(firstLog.message).toBe("Task started");
    expect(firstLog.taskId).toBe("task-001");
    expect(firstLog.agentId).toBe("agent-01");

    const secondLog = JSON.parse(secondLine as string);
    expect(secondLog.level).toBe("DEBUG");
    expect(secondLog.message).toBe("Processing step");
    expect(secondLog.step).toBe(1);
  });

  test("writes to both pretty and JSONL files simultaneously", async () => {
    await configureLogging({
      level: "info",
      sinks: {
        console: false,
        files: [
          { path: PRETTY_LOG_PATH, format: "pretty" },
          { path: JSON_LOG_PATH, format: "json" },
        ],
      },
    });

    const logger = getLogger("aop", "dual");
    logger.info("Dual output test", { value: 42 });
    logger.error("Error occurred", { code: "E001" });

    await Bun.sleep(50);
    await resetLogging();

    // Verify pretty file
    const prettyContent = await Bun.file(PRETTY_LOG_PATH).text();
    expect(prettyContent).toContain("Dual output test");
    expect(prettyContent).toContain("Error occurred");

    // Verify JSONL file
    const jsonContent = await Bun.file(JSON_LOG_PATH).text();
    const jsonLines = jsonContent.trim().split("\n").filter(Boolean);
    expect(jsonLines.length).toBe(2);

    const parsed = jsonLines.map((line) => JSON.parse(line));
    expect(parsed[0].message).toBe("Dual output test");
    expect(parsed[0].value).toBe(42);
    expect(parsed[1].message).toBe("Error occurred");
    expect(parsed[1].code).toBe("E001");
  });
});

describe("rotating file sinks", () => {
  const ROTATING_LOG_DIR = "tmp/aop-rotating-test";
  const ROTATING_PRETTY_PATH = `${ROTATING_LOG_DIR}/app.log`;
  const ROTATING_JSON_PATH = `${ROTATING_LOG_DIR}/app.jsonl`;

  beforeEach(async () => {
    await resetLogging();
    if (existsSync(ROTATING_LOG_DIR)) {
      rmSync(ROTATING_LOG_DIR, { recursive: true });
    }
    mkdirSync(ROTATING_LOG_DIR, { recursive: true });
  });

  test("configures rotating file sink with maxSize and maxFiles", async () => {
    await configureLogging({
      level: "info",
      sinks: {
        console: false,
        files: [
          { path: ROTATING_PRETTY_PATH, format: "pretty", maxSize: 1024 * 1024, maxFiles: 3 },
        ],
      },
    });

    const logger = getLogger("aop", "rotating");
    logger.info("Rotating log test", { id: 1 });

    await Bun.sleep(100);
    await resetLogging();

    const content = await Bun.file(ROTATING_PRETTY_PATH).text();
    expect(content).toContain("Rotating log test");
  });

  test("writes to both rotating pretty and JSONL files", async () => {
    await configureLogging({
      level: "info",
      sinks: {
        console: false,
        files: [
          { path: ROTATING_PRETTY_PATH, format: "pretty", maxSize: 10 * 1024 * 1024, maxFiles: 5 },
          { path: ROTATING_JSON_PATH, format: "json", maxSize: 10 * 1024 * 1024, maxFiles: 5 },
        ],
      },
    });

    const logger = getLogger("aop", "dual-rotating");
    logger.info("Dual rotating test", { value: 123 });
    logger.warn("Warning message", { code: "W001" });

    await Bun.sleep(100);
    await resetLogging();

    // Verify pretty file
    const prettyContent = await Bun.file(ROTATING_PRETTY_PATH).text();
    expect(prettyContent).toContain("Dual rotating test");
    expect(prettyContent).toContain("Warning message");

    // Verify JSONL file
    const jsonContent = await Bun.file(ROTATING_JSON_PATH).text();
    const jsonLines = jsonContent.trim().split("\n").filter(Boolean);
    expect(jsonLines.length).toBe(2);

    const parsed = jsonLines.map((line) => JSON.parse(line));
    expect(parsed[0].message).toBe("Dual rotating test");
    expect(parsed[0].value).toBe(123);
    expect(parsed[1].message).toBe("Warning message");
    expect(parsed[1].code).toBe("W001");
  });

  test("uses default maxFiles when only maxSize is specified", async () => {
    await configureLogging({
      level: "debug",
      sinks: {
        console: false,
        files: [{ path: ROTATING_JSON_PATH, format: "json", maxSize: 5 * 1024 * 1024 }],
      },
    });

    const logger = getLogger("aop", "default-max-files");
    logger.debug("Test with default maxFiles", { test: true });

    await Bun.sleep(100);
    await resetLogging();

    const content = await Bun.file(ROTATING_JSON_PATH).text();
    expect(content).toContain("Test with default maxFiles");
  });
});
