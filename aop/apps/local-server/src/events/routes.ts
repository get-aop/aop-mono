import type { SSEInitEvent } from "@aop/common";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { LocalServerContext } from "../context.ts";
import { getServerStatus } from "../status/handlers.ts";
import type { TaskEvent } from "./task-events.ts";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

type SSEEventUnion = SSEInitEvent | TaskEvent;

interface EventsSSEHandlerOptions {
  heartbeatIntervalMs?: number;
}

export const createEventsSSEHandler = (
  ctx: LocalServerContext,
  options: EventsSSEHandlerOptions = {},
) => {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  return async (c: Context) => {
    return streamSSE(c, async (stream) => {
      let eventId = 0;

      const sendEvent = async (event: SSEEventUnion) => {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
          id: String(eventId++),
        });
      };

      const initialStatus = await getServerStatus(ctx);
      await sendEvent({ type: "init", status: initialStatus });

      const unsubscribe = ctx.taskEventEmitter.subscribe(async (event: TaskEvent) => {
        await sendEvent(event);
      });

      const heartbeatInterval = setInterval(async () => {
        try {
          await stream.writeSSE({
            data: "",
            event: "heartbeat",
            id: String(eventId++),
          });
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, heartbeatIntervalMs);

      stream.onAbort(() => {
        unsubscribe();
        clearInterval(heartbeatInterval);
      });

      await new Promise(() => {});
    });
  };
};
