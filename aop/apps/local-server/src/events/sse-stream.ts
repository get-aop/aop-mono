import type { SSEStreamingApi } from "hono/streaming";

export interface SSEStreamHelper {
  sendEvent: <T>(type: string, data: T) => Promise<boolean>;
  sendRaw: (type: string, data: string) => Promise<boolean>;
  registerCleanup: (fn: () => void) => void;
  runCleanup: () => void;
  isCleanedUp: () => boolean;
}

export const createSSEStreamHelper = (stream: SSEStreamingApi): SSEStreamHelper => {
  let eventId = 0;
  const cleanupFns: (() => void)[] = [];
  let cleanedUp = false;

  const runCleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const fn of cleanupFns) {
      fn();
    }
    cleanupFns.length = 0;
  };

  stream.onAbort(runCleanup);

  const sendRaw = async (type: string, data: string): Promise<boolean> => {
    if (cleanedUp) return false;
    try {
      await stream.writeSSE({
        data,
        event: type,
        id: String(eventId++),
      });
      return true;
    } catch {
      runCleanup();
      return false;
    }
  };

  return {
    sendEvent: async <T>(type: string, data: T): Promise<boolean> => {
      return sendRaw(type, JSON.stringify(data));
    },

    sendRaw,

    registerCleanup: (fn: () => void): void => {
      cleanupFns.push(fn);
    },

    runCleanup,

    isCleanedUp: () => cleanedUp,
  };
};
