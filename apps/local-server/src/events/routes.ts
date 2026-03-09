import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { LocalServerContext } from "../context.ts";
import { getServerStatus } from "../status/handlers.ts";
import { createSSEStreamHelper } from "./sse-stream.ts";
import type { TaskEvent } from "./task-events.ts";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 3_000;

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
      const sse = createSSEStreamHelper(stream);

      // Subscribe BEFORE sending init to avoid missing events during setup
      const unsubscribe = ctx.taskEventEmitter.subscribe(async (event: TaskEvent) => {
        await sse.sendEvent(event.type, event);
      });
      sse.registerCleanup(unsubscribe);

      const initialStatus = await getServerStatus(ctx);
      const initSent = await sse.sendEvent("init", { type: "init", status: initialStatus });
      if (!initSent) return;

      // Immediate heartbeat to detect fast disconnects (e.g., hot reload)
      const probeSent = await sse.sendRaw("heartbeat", "");
      if (!probeSent) return;

      const heartbeatInterval = setInterval(async () => {
        const sent = await sse.sendRaw("heartbeat", "");
        if (!sent) {
          clearInterval(heartbeatInterval);
        }
      }, heartbeatIntervalMs);
      sse.registerCleanup(() => clearInterval(heartbeatInterval));

      await new Promise(() => {});
    });
  };
};
