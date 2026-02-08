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
import { getActiveSpanId, getActiveTraceId } from "./tracing.ts";

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
  serviceName?: string;
  sinks?: {
    console?: boolean;
    files?: FileSinkOptions[];
  };
}

let currentServiceName: string | undefined;

const SERVICE_COLORS: Record<string, string> = {
  server: "\x1b[32m",
  "local-server": "\x1b[33m",
  dashboard: "\x1b[35m",
  dev: "\x1b[36m",
  cli: "\x1b[34m",
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const LEVEL_EMOJI: Record<string, string> = {
  debug: "\u{1f41b}",
  info: "\u{2728}",
  warning: "\u{26a0}\u{fe0f}",
  error: "\u{274c}",
  fatal: "\u{1f480}",
};

const LEVEL_COLOR: Record<string, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warning: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[31;1m",
};

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
 * const logger = getLogger("orchestrator");
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
  currentServiceName = options.serviceName;

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

const enrichRecord = (record: LogRecord): LogRecord => {
  const extra: Record<string, unknown> = {};
  if (currentServiceName) extra.service = currentServiceName;
  const traceId = getActiveTraceId();
  const spanId = getActiveSpanId();
  if (traceId) extra.traceId = traceId;
  if (spanId) extra.spanId = spanId;
  if (Object.keys(extra).length === 0) return record;
  return { ...record, properties: { ...extra, ...record.properties } };
};

const wrapSink =
  (sink: Sink): Sink =>
  (record: LogRecord) =>
    sink(enrichRecord(record));

const buildSinks = (
  opts: ResolvedOptions,
): { sinks: Record<string, Sink>; sinkNames: string[] } => {
  const sinks: Record<string, Sink> = {};
  const sinkNames: string[] = [];

  if (opts.sinks.console) {
    sinks.console = wrapSink(createConsoleSink(opts.format));
    sinkNames.push("console");
  }

  for (const fileOpts of opts.sinks.files) {
    const sinkName = `file:${fileOpts.path}`;
    sinks[sinkName] = wrapSink(createFileSink(fileOpts));
    sinkNames.push(sinkName);
  }

  return { sinks, sinkNames };
};

const formatServicePrefix = (service: string, colors: boolean): string => {
  if (!colors) return `[${service}]`;
  const color = SERVICE_COLORS[service] ?? "";
  return color ? `${color}[${service}]${RESET}` : `[${service}]`;
};

const formatTraceAbbrev = (traceId: string): string => `t:${traceId.slice(0, 8)}`;

const CATEGORY_WIDTH = 20;
const LEVEL_WIDTH = 7; // "warning".length

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
};

const stringifyPart = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.message;
  if (typeof v === "object" && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
};

const renderMessage = (parts: readonly unknown[]): string => parts.map(stringifyPart).join("");

const inspectValue = (v: unknown): string => {
  if (v instanceof Error) return v.stack ?? v.message;
  if (typeof v === "string") return `'${v}'`;
  if (v === null || v === undefined || typeof v === "number" || typeof v === "boolean")
    return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

type AnsiFormatter = (code: string, text: string) => string;

const buildHeaderColumns = (
  record: LogRecord,
  service: string | undefined,
  traceId: string | undefined,
  colors: boolean,
  ansi: AnsiFormatter,
): string => {
  const time = ansi(DIM, formatTime(record.timestamp));
  const level = ansi(
    LEVEL_COLOR[record.level] ?? "",
    `${LEVEL_EMOJI[record.level] ?? ""} ${record.level.padEnd(LEVEL_WIDTH)}`,
  );
  const category = ansi(DIM, record.category.join("\u{00b7}").padEnd(CATEGORY_WIDTH));

  const cols: string[] = [time];
  if (service) cols.push(formatServicePrefix(service, colors));
  cols.push(category);
  if (traceId) cols.push(ansi(DIM, formatTraceAbbrev(traceId)));
  cols.push(level);

  return cols.join("  ");
};

const formatProperties = (
  props: Record<string, unknown>,
  indentWidth: number,
  ansi: AnsiFormatter,
): string => {
  const entries = Object.entries(props);
  if (entries.length === 0) return "";
  const indent = " ".repeat(indentWidth);
  return entries
    .map(([key, val]) => `\n${indent}${ansi(DIM, `${key}:`)} ${inspectValue(val)}`)
    .join("");
};

const createPrettyFormatter = (colors: boolean) => {
  const ansi: AnsiFormatter = (code, text) => (colors ? `${code}${text}${RESET}` : text);

  return (record: LogRecord): string => {
    const { service, traceId } = record.properties as { service?: string; traceId?: string };
    const { service: _s, traceId: _t, spanId: _sp, ...restProps } = record.properties;

    const header = buildHeaderColumns(record, service, traceId, colors, ansi);
    const message = renderMessage(record.message);
    const props = formatProperties(restProps, stripAnsi(header).length + 1, ansi);

    return `${header} ${message}${props}\n`;
  };
};

const createFormatter = (format: LogFormat, colors = true) =>
  format === "json"
    ? getJsonLinesFormatter({ properties: "flatten" })
    : createPrettyFormatter(colors);

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
  currentServiceName = undefined;
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
