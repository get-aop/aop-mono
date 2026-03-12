import { existsSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import {
  parseRawJsonlContent,
  type RenderedLogLine,
  renderCompactLogLines,
} from "@aop/llm-provider";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { LocalServerContext } from "../context.ts";
import { isProcessAlive as defaultIsProcessAlive } from "../executor/process-utils.ts";
import { getFileSize, readLogLines } from "./log-file-tailer.ts";
import { createSSEStreamHelper, type SSEStreamHelper } from "./sse-stream.ts";

interface LogSSEEvent {
  type: "log";
  stream: "stdout" | "stderr";
  content: string;
  timestamp: string;
}

interface ReplaySSEEvent {
  type: "replay";
  lines: RenderedLogLine[];
}

interface CompleteSSEEvent {
  type: "complete";
  status: "completed" | "failed" | "cancelled";
}

type SSEEventData = LogSSEEvent | ReplaySSEEvent | CompleteSSEEvent;

const POLL_INTERVAL_MS = 500;

const renderRawLines = (rawLines: string[]): RenderedLogLine[] => {
  if (rawLines.length === 0) return [];
  const parsed = parseRawJsonlContent(rawLines.join("\n"));
  return renderCompactLogLines(parsed);
};

const mapExecutionStatus = (status: string): "completed" | "failed" | "cancelled" => {
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "aborted") return "cancelled";
  return "failed";
};

const sendReplayIfExists = async (
  sse: SSEStreamHelper,
  lines: RenderedLogLine[],
): Promise<boolean> => {
  if (lines.length === 0) return true;
  return sse.sendEvent<SSEEventData>("message", { type: "replay", lines });
};

const sendComplete = async (
  sse: SSEStreamHelper,
  status: "completed" | "failed" | "cancelled",
): Promise<boolean> => {
  return sse.sendEvent<SSEEventData>("message", { type: "complete", status });
};

const sendLogLines = async (sse: SSEStreamHelper, lines: RenderedLogLine[]): Promise<boolean> => {
  for (const line of lines) {
    const ok = await sse.sendEvent<SSEEventData>("message", {
      type: "log",
      stream: line.stream,
      content: line.content,
      timestamp: line.timestamp,
    });
    if (!ok) return false;
  }
  return true;
};

export interface LogStreamDeps {
  logsDir?: string;
  isProcessAlive?: (pid: number) => boolean;
  pollIntervalMs?: number;
}

export const createLogStreamHandler = (ctx: LocalServerContext, deps: LogStreamDeps = {}) => {
  const {
    logsDir = aopPaths.logs(),
    isProcessAlive = defaultIsProcessAlive,
    pollIntervalMs = POLL_INTERVAL_MS,
  } = deps;

  return async (c: Context) => {
    const executionId = c.req.param("executionId");
    if (!executionId) {
      return c.json({ error: "Execution ID is required" }, 400);
    }

    const execution = await ctx.executionRepository.getExecution(executionId);
    if (!execution) {
      return c.json({ error: "Execution not found" }, 404);
    }

    if (execution.status !== "running") {
      return streamCompletedExecution(c, ctx, executionId, execution.status);
    }

    return streamRunningExecution(c, ctx, executionId, {
      logsDir,
      isProcessAlive,
      pollIntervalMs,
    });
  };
};

const streamCompletedExecution = (
  c: Context,
  ctx: LocalServerContext,
  executionId: string,
  status: string,
) => {
  return streamSSE(c, async (stream) => {
    const sse = createSSEStreamHelper(stream);
    const stepLogs = await ctx.executionRepository.getStepLogsByExecutionId(executionId);
    const rendered = renderRawLines(stepLogs.map((log) => log.content));
    await sendReplayIfExists(sse, rendered);
    await sendComplete(sse, mapExecutionStatus(status));
  });
};

const streamRunningExecution = async (
  c: Context,
  ctx: LocalServerContext,
  executionId: string,
  deps: Required<LogStreamDeps>,
) => {
  const { logsDir, isProcessAlive, pollIntervalMs } = deps;

  const stepExecution = await findLatestStep(ctx, executionId);
  const candidateLogFile = stepExecution ? join(logsDir, `${stepExecution.id}.jsonl`) : null;
  const logFile = candidateLogFile && existsSync(candidateLogFile) ? candidateLogFile : null;
  const agentPid = stepExecution?.agent_pid ?? null;
  const stepExecutionId = stepExecution?.id ?? null;

  const stepLogs = await ctx.executionRepository.getStepLogsByExecutionId(executionId);
  const historicalRawLines = stepLogs.map((log) => log.content);

  const lastEventId = c.req.header("Last-Event-ID");
  const resumeOffset = lastEventId ? Number.parseInt(lastEventId, 10) + 1 : 0;

  return streamSSE(c, async (stream) => {
    const sse = createSSEStreamHelper(stream, resumeOffset);

    if (!logFile || !stepExecutionId) {
      await streamFromLogBuffer(ctx, stepExecutionId, sse, stream);
      return;
    }

    await streamFromFile({
      sse,
      stream,
      logFile,
      agentPid,
      resumeOffset,
      pollIntervalMs,
      isProcessAlive,
      executionId,
      ctx,
      historicalRawLines,
    });
  });
};

interface StreamFromFileOptions {
  sse: SSEStreamHelper;
  stream: { close: () => void; onAbort: (fn: () => void) => void };
  logFile: string;
  agentPid: number | null;
  resumeOffset: number;
  pollIntervalMs: number;
  isProcessAlive: (pid: number) => boolean;
  executionId: string;
  ctx: LocalServerContext;
  historicalRawLines: string[];
}

const isAgentDone = async (opts: StreamFromFileOptions): Promise<boolean> => {
  const { agentPid, isProcessAlive, executionId, ctx } = opts;
  if (agentPid) return !isProcessAlive(agentPid);
  const execution = await ctx.executionRepository.getExecution(executionId);
  return !execution || execution.status !== "running";
};

const streamFromFile = async (opts: StreamFromFileOptions): Promise<void> => {
  const { sse, logFile, resumeOffset, historicalRawLines } = opts;

  const snapshot = readLogLines(logFile, resumeOffset);
  const allRawLines =
    historicalRawLines.length > 0 ? [...historicalRawLines, ...snapshot.lines] : snapshot.lines;
  const replayLines = renderRawLines(allRawLines);
  const sent = await sendReplayIfExists(sse, replayLines);
  if (!sent) return;

  sse.setNextEventId(Math.max(snapshot.lineCount, resumeOffset));

  const state = { lineCount: snapshot.lineCount, fileSize: getFileSize(logFile) };

  if (await isAgentDone(opts)) {
    await finishFromFile(opts, state.lineCount);
    return;
  }

  await pollFileUntilDone(opts, state);
};

interface PollState {
  lineCount: number;
  fileSize: number;
}

const pollFileUntilDone = (opts: StreamFromFileOptions, state: PollState): Promise<void> => {
  const { sse, stream, pollIntervalMs } = opts;

  return new Promise<void>((resolve) => {
    const stop = (intervalId: ReturnType<typeof setInterval>) => {
      clearInterval(intervalId);
      resolve();
    };

    const interval = setInterval(async () => {
      if (sse.isCleanedUp()) return stop(interval);

      await pollOnce(opts, state);

      if (await isAgentDone(opts)) {
        clearInterval(interval);
        await finishFromFile(opts, state.lineCount);
        resolve();
      }
    }, pollIntervalMs);

    sse.registerCleanup(() => clearInterval(interval));
    stream.onAbort(() => stop(interval));
  });
};

const pollOnce = async (opts: StreamFromFileOptions, state: PollState): Promise<void> => {
  const { sse, logFile } = opts;
  const newSize = getFileSize(logFile);
  if (newSize <= state.fileSize) return;

  state.fileSize = newSize;
  const fresh = readLogLines(logFile, state.lineCount);
  const rendered = renderRawLines(fresh.lines);
  await sendLogLines(sse, rendered);
  state.lineCount = fresh.lineCount;
};

const findLatestStep = async (ctx: LocalServerContext, executionId: string) => {
  const steps = await ctx.executionRepository.getStepExecutionsByExecutionId(executionId);
  return steps.length > 0 ? steps[steps.length - 1] : null;
};

const finishFromFile = async (
  opts: StreamFromFileOptions,
  currentLineCount: number,
): Promise<void> => {
  const { sse, stream, logFile, executionId, ctx } = opts;

  const remaining = readLogLines(logFile, currentLineCount);
  const rendered = renderRawLines(remaining.lines);
  await sendLogLines(sse, rendered);

  const execution = await ctx.executionRepository.getExecution(executionId);
  const status = execution ? mapExecutionStatus(execution.status) : "failed";
  await sendComplete(sse, status);
  sse.runCleanup();
  stream.close();
};

const streamFromLogBuffer = async (
  ctx: LocalServerContext,
  stepExecutionId: string | null,
  sse: SSEStreamHelper,
  stream: { close: () => void },
): Promise<void> => {
  if (!stepExecutionId) {
    await sendComplete(sse, "failed");
    stream.close();
    return;
  }

  let completionHandled = false;

  const handleCompletion = (status: "completed" | "failed" | "cancelled") => {
    if (completionHandled || sse.isCleanedUp()) return;
    completionHandled = true;
    sendComplete(sse, status).finally(() => {
      sse.runCleanup();
      stream.close();
    });
  };

  const unsubscribeLog = ctx.logBuffer.subscribe(async (event) => {
    if (event.stepExecutionId !== stepExecutionId) return;
    const rendered = renderRawLines([event.line]);
    for (const line of rendered) {
      await sse.sendEvent<SSEEventData>("message", {
        type: "log",
        stream: line.stream,
        content: line.content,
        timestamp: line.timestamp,
      });
    }
  });
  sse.registerCleanup(unsubscribeLog);

  const unsubscribeComplete = ctx.logBuffer.subscribeComplete((event) => {
    if (event.stepExecutionId !== stepExecutionId) return;
    handleCompletion(event.status);
  });
  sse.registerCleanup(unsubscribeComplete);

  const existingLines = ctx.logBuffer.getLines(stepExecutionId);
  const rendered = renderRawLines(existingLines);
  const sent = await sendReplayIfExists(sse, rendered);
  if (!sent) return;

  const existingStatus = ctx.logBuffer.getStatus(stepExecutionId);
  if (existingStatus && !completionHandled) {
    completionHandled = true;
    await sendComplete(sse, existingStatus);
    sse.runCleanup();
    stream.close();
    return;
  }

  await new Promise(() => {});
};
