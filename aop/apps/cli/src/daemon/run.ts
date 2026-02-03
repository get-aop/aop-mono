#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { configureLogging, getLogger, type LoggingOptions, type LogLevel } from "@aop/infra";
import { createDaemon } from "./daemon.ts";

const AOP_DIR = join(homedir(), ".aop");
const LOG_DIR = process.env.AOP_LOG_DIR ?? join(AOP_DIR, "logs");
const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const LOG_MAX_FILES = 5;

const setupLogging = async (): Promise<void> => {
  await mkdir(LOG_DIR, { recursive: true });
  const logLevel = (process.env.AOP_LOG_LEVEL as LogLevel) || "info";

  const options: LoggingOptions = {
    level: logLevel,
    format: "pretty",
    sinks: {
      console: false,
      files: [
        {
          path: `${LOG_DIR}/daemon.jsonl`,
          format: "json",
          maxSize: LOG_MAX_SIZE,
          maxFiles: LOG_MAX_FILES,
        },
        {
          path: `${LOG_DIR}/daemon.log`,
          format: "pretty",
          maxSize: LOG_MAX_SIZE,
          maxFiles: LOG_MAX_FILES,
        },
      ],
    },
  };

  await configureLogging(options);
};

const main = async (): Promise<void> => {
  await setupLogging();
  const logger = getLogger("aop", "daemon", "run");
  logger.info("Starting daemon process");

  const daemon = createDaemon({
    dbPath: process.env.AOP_DB_PATH,
    pidFile: process.env.AOP_PID_FILE,
  });
  await daemon.start();
};

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsole: fallback for when logging isn't configured
  console.error("Daemon failed to start:", err);
  const errorLogger = getLogger("aop", "daemon", "run");
  errorLogger.error("Daemon failed to start: {errorMsg}", { errorMsg: String(err), err });
  process.exit(1);
});
