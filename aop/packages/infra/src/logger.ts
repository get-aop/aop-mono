import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getRotatingFileSink } from "@logtape/file";
import {
  configure,
  getConsoleSink,
  getJsonLinesFormatter,
  type Logger,
  type LogLevel,
  type LogRecord,
  getLogger as logtapeGetLogger,
  reset as logtapeReset,
  type Sink,
} from "@logtape/logtape";
import { getPrettyFormatter } from "@logtape/pretty";

export type { Logger, LogLevel } from "@logtape/logtape";

const DEFAULT_FLUSH_INTERVAL_MS = 1000;

export type LogFormat = "pretty" | "json";

export interface FileSinkOptions {
  path: string;
  format: LogFormat;
  /** Enable rotation with maxSize in bytes (e.g., 10 * 1024 * 1024 for 10MB) */
  maxSize?: number;
  /** Number of rotated files to keep (default: 5) */
  maxFiles?: number;
}

export interface LoggingOptions {
  level?: LogLevel;
  format?: LogFormat;
  sinks?: {
    console?: boolean;
    files?: FileSinkOptions[];
  };
}

const DEFAULT_OPTIONS = {
  level: "debug" as LogLevel,
  format: "pretty" as LogFormat,
  sinks: { console: true, files: [] as FileSinkOptions[] },
};

/**
 * Get a logger for the given category hierarchy.
 * Works immediately - logs are no-op until configureLogging() is called.
 *
 * Uses template literals: {placeholder} in message gets replaced with property value.
 *
 * @example
 * const logger = getLogger("aop", "orchestrator");
 * logger.info("Task {taskId} started", { taskId: "123" });
 * // Output: Task 123 started
 */
export const getLogger = (...categories: string[]): Logger => logtapeGetLogger(categories);

/**
 * Configure logging for the application.
 * Call once at app startup. Safe to call multiple times (reconfigures).
 *
 * @example
 * // Simplest - uses sensible defaults (debug level, pretty console output)
 * await configureLogging();
 *
 * // Custom level
 * await configureLogging({ level: "info" });
 *
 * // JSON format for servers
 * await configureLogging({ format: "json" });
 */
export const configureLogging = async (options: LoggingOptions = {}): Promise<void> => {
  const opts = {
    level: options.level ?? DEFAULT_OPTIONS.level,
    format: options.format ?? DEFAULT_OPTIONS.format,
    sinks: {
      console: options.sinks?.console ?? DEFAULT_OPTIONS.sinks.console,
      files: options.sinks?.files ?? DEFAULT_OPTIONS.sinks.files,
    },
  };

  const { sinks, sinkNames } = buildSinks(opts);

  await configure({
    reset: true,
    sinks,
    loggers: [
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: sinkNames },
      { category: [], lowestLevel: opts.level, sinks: sinkNames },
    ],
  });
};

interface ResolvedOptions {
  level: LogLevel;
  format: LogFormat;
  sinks: { console: boolean; files: FileSinkOptions[] };
}

const buildSinks = (
  opts: ResolvedOptions,
): { sinks: Record<string, Sink>; sinkNames: string[] } => {
  const sinks: Record<string, Sink> = {};
  const sinkNames: string[] = [];

  if (opts.sinks.console) {
    sinks.console = createConsoleSink(opts.format);
    sinkNames.push("console");
  }

  for (const fileOpts of opts.sinks.files) {
    const sinkName = `file:${fileOpts.path}`;
    sinks[sinkName] = createFileSink(fileOpts);
    sinkNames.push(sinkName);
  }

  return { sinks, sinkNames };
};

const createFormatter = (format: LogFormat, colors = true) =>
  format === "json"
    ? getJsonLinesFormatter({ properties: "flatten" })
    : getPrettyFormatter({ timestamp: "time", properties: true, colors });

const createConsoleSink = (format: LogFormat): Sink =>
  getConsoleSink({ formatter: createFormatter(format) });

interface BufferedFileSink {
  path: string;
  buffer: string[];
  flushInterval: Timer;
}

const activeBufferedSinks: BufferedFileSink[] = [];
const activeRotatingSinks: Disposable[] = [];

/**
 * Flush all buffered logs to disk immediately.
 * Call this on graceful shutdown to ensure no logs are lost.
 */
export const flushLogs = (): void => {
  for (const sink of activeBufferedSinks) {
    flushBuffer(sink);
  }
};

/**
 * Cleanup all file writers and stop flush intervals.
 * Call this when shutting down the application.
 */
export const cleanupLoggers = (): void => {
  // Clean up buffered sinks
  for (const sink of activeBufferedSinks) {
    clearInterval(sink.flushInterval);
    flushBuffer(sink);
  }
  activeBufferedSinks.length = 0;

  // Dispose rotating sinks (stops their internal flush timers)
  // Only dispose if not followed by logtapeReset() which also disposes
  for (const sink of activeRotatingSinks) {
    sink[Symbol.dispose]();
  }
  activeRotatingSinks.length = 0;
};

/**
 * Cleanup loggers without disposing rotating sinks (logtapeReset handles those).
 */
const cleanupLoggersForReset = (): void => {
  for (const sink of activeBufferedSinks) {
    clearInterval(sink.flushInterval);
    flushBuffer(sink);
  }
  activeBufferedSinks.length = 0;
  activeRotatingSinks.length = 0;
};

/**
 * Reset logging configuration and flush all buffered logs.
 * Wraps logtape's reset to also clean up file sinks.
 */
export const resetLogging = async (): Promise<void> => {
  cleanupLoggersForReset();
  await logtapeReset();
};

const flushBuffer = (sink: BufferedFileSink): void => {
  if (sink.buffer.length === 0) return;
  const data = sink.buffer.join("");
  sink.buffer.length = 0;
  appendFileSync(sink.path, data);
};

const createFileSink = (opts: FileSinkOptions): Sink => {
  const formatter = createFormatter(opts.format, false);

  if (opts.maxSize && opts.maxSize > 0) {
    // bufferSize: 0 for immediate writes - logtape's flushInterval only checks on writes,
    // not via a timer, so it doesn't help for low-volume logging
    const rotatingSink = getRotatingFileSink(opts.path, {
      maxSize: opts.maxSize,
      maxFiles: opts.maxFiles ?? 5,
      formatter,
      bufferSize: 0,
    });
    activeRotatingSinks.push(rotatingSink);
    return rotatingSink;
  }

  return createBufferedFileSink(opts.path, formatter);
};

const createBufferedFileSink = (path: string, formatter: (record: LogRecord) => string): Sink => {
  // Ensure directory exists
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sink: BufferedFileSink = {
    path,
    buffer: [],
    flushInterval: setInterval(() => flushBuffer(sink), DEFAULT_FLUSH_INTERVAL_MS),
  };

  activeBufferedSinks.push(sink);

  return (record: LogRecord) => {
    const formatted = formatter(record);
    sink.buffer.push(formatted);
  };
};
