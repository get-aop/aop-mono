import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { LocalServerContext } from "../context.ts";
import type { ExecutionCompleteEvent, LogEvent, LogLine } from "./log-buffer.ts";
import { createSSEStreamHelper, type SSEStreamHelper } from "./sse-stream.ts";

interface LogSSEEvent {
  type: "log";
  stream: "stdout" | "stderr";
  content: string;
  timestamp: string;
}

interface ReplaySSEEvent {
  type: "replay";
  lines: LogLine[];
}

interface CompleteSSEEvent {
  type: "complete";
  status: "completed" | "failed" | "cancelled";
}

type SSEEventData = LogSSEEvent | ReplaySSEEvent | CompleteSSEEvent;

const mapExecutionStatus = (status: string): "completed" | "failed" | "cancelled" => {
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "aborted") return "cancelled";
  return "failed";
};

const sendReplayIfExists = async (sse: SSEStreamHelper, lines: LogLine[]): Promise<boolean> => {
  if (lines.length === 0) return true;
  return sse.sendEvent<SSEEventData>("message", { type: "replay", lines });
};

const sendComplete = async (
  sse: SSEStreamHelper,
  status: "completed" | "failed" | "cancelled",
): Promise<boolean> => {
  return sse.sendEvent<SSEEventData>("message", { type: "complete", status });
};

export const createLogStreamHandler = (ctx: LocalServerContext) => {
  return async (c: Context) => {
    const executionId = c.req.param("executionId");

    const execution = await ctx.executionRepository.getExecution(executionId);
    if (!execution) {
      return c.json({ error: "Execution not found" }, 404);
    }

    if (execution.status !== "running") {
      return streamSSE(c, async (stream) => {
        const sse = createSSEStreamHelper(stream);
        const persistedLogs = await ctx.executionRepository.getExecutionLogs(executionId);
        const lines: LogLine[] = persistedLogs.map((log) => ({
          stream: log.stream,
          content: log.content,
          timestamp: log.timestamp,
        }));
        await sendReplayIfExists(sse, lines);
        await sendComplete(sse, mapExecutionStatus(execution.status));
      });
    }

    return streamSSE(c, async (stream) => {
      const sse = createSSEStreamHelper(stream);
      let completionHandled = false;

      const handleCompletion = (status: "completed" | "failed" | "cancelled") => {
        if (completionHandled || sse.isCleanedUp()) return;
        completionHandled = true;
        // Send complete BEFORE cleanup so the message gets through
        sendComplete(sse, status).finally(() => {
          sse.runCleanup();
          stream.close();
        });
      };

      const unsubscribeLog = ctx.logBuffer.subscribe(async (event: LogEvent) => {
        if (event.executionId !== executionId) return;
        await sse.sendEvent<SSEEventData>("message", {
          type: "log",
          stream: event.line.stream,
          content: event.line.content,
          timestamp: event.line.timestamp,
        });
      });
      sse.registerCleanup(unsubscribeLog);

      const unsubscribeComplete = ctx.logBuffer.subscribeComplete(
        (event: ExecutionCompleteEvent) => {
          if (event.executionId !== executionId) return;
          handleCompletion(event.status);
        },
      );
      sse.registerCleanup(unsubscribeComplete);

      const existingLines = ctx.logBuffer.getLines(executionId);
      const sent = await sendReplayIfExists(sse, existingLines);
      if (!sent) return;

      const existingStatus = ctx.logBuffer.getStatus(executionId);
      if (existingStatus && !completionHandled) {
        completionHandled = true;
        await sendComplete(sse, existingStatus);
        sse.runCleanup();
        stream.close();
        return;
      }

      await new Promise(() => {});
    });
  };
};
