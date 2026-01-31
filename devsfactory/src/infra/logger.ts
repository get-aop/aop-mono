import {
  configure,
  getConsoleSink,
  getLogger as getLogtapeLogger,
  jsonLinesFormatter,
  type LogLevel,
  type LogRecord,
  reset,
  type Sink
} from "@logtape/logtape";
import { getPrettyFormatter } from "@logtape/pretty";

export type LogCategory =
  | "orchestrator"
  | "watcher"
  | "agent"
  | "merge"
  | "state"
  | "git"
  | "e2e"
  | "sdk-agent-runner"
  | "job-producer"
  | "job-worker";

const LOG_MODE = process.env.LOG_MODE ?? "pretty";
const DEBUG = process.env.DEBUG === "true" || process.env.DEBUG === "1";
const LOG_LEVEL: LogLevel = DEBUG ? "debug" : "info";

let configured = false;

const AGENT_COLORS = [
  "\x1b[36m", // cyan
  "\x1b[33m", // yellow
  "\x1b[35m", // magenta
  "\x1b[32m", // green
  "\x1b[34m", // blue
  "\x1b[91m", // bright red
  "\x1b[92m", // bright green
  "\x1b[93m" // bright yellow
];
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const agentColorMap = new Map<string, string>();
let colorIndex = 0;

const getAgentColor = (agentId: string): string => {
  let color = agentColorMap.get(agentId);
  if (!color) {
    color = AGENT_COLORS[colorIndex % AGENT_COLORS.length]!;
    agentColorMap.set(agentId, color);
    colorIndex++;
  }
  return color;
};

const formatTimestamp = (ts: number): string => {
  const date = new Date(ts);
  return date.toTimeString().slice(0, 8);
};

const formatAgentLog = (record: LogRecord): string => {
  const props = record.properties as Record<string, unknown>;
  const agentId = String(props.agentId ?? "unknown");
  const agentType = String(props.agentType ?? "agent");
  const subtask = props.subtask ? String(props.subtask).replace(".md", "") : "";
  const output = props.output ? String(props.output) : "";

  const color = getAgentColor(agentId.slice(-8));
  const shortId = agentId.slice(-8);
  const subtaskPart = subtask ? `:${subtask}` : "";
  const timestamp = formatTimestamp(record.timestamp);

  return `${DIM}${timestamp}${RESET} ${color}${agentType}${subtaskPart}${RESET} ${DIM}[${shortId}]${RESET} ${color}│${RESET} ${output}`;
};

const createAgentSink = (fallbackSink: Sink): Sink => {
  return (record: LogRecord) => {
    const isAgentCategory =
      record.category.length >= 2 && record.category[1] === "agent";
    const props = record.properties as Record<string, unknown> | undefined;
    const hasAgentOutput = props && props.output !== undefined;

    if (isAgentCategory && hasAgentOutput) {
      console.log(formatAgentLog(record));
    } else {
      fallbackSink(record);
    }
  };
};

export const configureLogger = async (): Promise<void> => {
  if (configured) return;

  const formatter =
    LOG_MODE === "json"
      ? jsonLinesFormatter
      : getPrettyFormatter({ timestamp: "time" });

  const baseSink = getConsoleSink({ formatter });
  const sink = LOG_MODE === "pretty" ? createAgentSink(baseSink) : baseSink;

  await configure({
    sinks: { console: sink },
    loggers: [
      { category: ["devsfactory"], lowestLevel: LOG_LEVEL, sinks: ["console"] }
    ]
  });

  configured = true;
};

export const resetLogger = async (): Promise<void> => {
  await reset();
  configured = false;
};

export const getLogger = (category: LogCategory) => {
  return getLogtapeLogger(["devsfactory", category]);
};

export const isDebugEnabled = (): boolean => DEBUG;
