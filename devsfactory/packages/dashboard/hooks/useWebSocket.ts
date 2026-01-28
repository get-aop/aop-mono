import { useEffect, useRef } from "react";
import type { StoreApi } from "zustand";
import type { DashboardStore } from "../store";
import type { ServerEvent } from "../types";

interface UseWebSocketOptions {
  store: StoreApi<DashboardStore>;
  url?: string;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

export const useWebSocket = ({
  store,
  url = "ws://localhost:3000/api/events"
}: UseWebSocketOptions) => {
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        store.getState().setConnected(true);
        backoffRef.current = INITIAL_BACKOFF_MS;
      };

      ws.onclose = (event) => {
        store.getState().setConnected(false);

        if (event.code !== 1000) {
          const currentBackoff = backoffRef.current;
          backoffRef.current = Math.min(currentBackoff * 2, MAX_BACKOFF_MS);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, currentBackoff);
        }
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data) as ServerEvent;
        store.getState().updateFromServer(data);
      };
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [store, url]);
};
