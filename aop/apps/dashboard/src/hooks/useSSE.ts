import { useCallback, useEffect, useRef, useState } from "react";

export interface UseSSEOptions<T> {
  url: string | null;
  eventTypes?: string[];
  onMessage?: (event: string, data: T) => void;
  onComplete?: () => void;
}

export interface UseSSEState {
  connected: boolean;
  error: Error | null;
}

const MIN_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;

export const useSSE = <T = unknown>(options: UseSSEOptions<T>): UseSSEState => {
  const { url, eventTypes = ["message"], onMessage, onComplete } = options;
  const [state, setState] = useState<UseSSEState>({
    connected: false,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Store callbacks in refs to avoid recreating connect on every render
  const onMessageRef = useRef(onMessage);
  const onCompleteRef = useRef(onComplete);
  const eventTypesRef = useRef(eventTypes);
  onMessageRef.current = onMessage;
  onCompleteRef.current = onComplete;
  eventTypesRef.current = eventTypes;

  const getRetryDelay = useCallback(() => {
    const delay = Math.min(MIN_RETRY_DELAY * 2 ** retryCountRef.current, MAX_RETRY_DELAY);
    return delay + Math.random() * 1000;
  }, []);

  const connect = useCallback(() => {
    if (!url) return;

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      retryCountRef.current = 0;
      setState({ connected: true, error: null });
    };

    eventSource.onerror = () => {
      eventSource.close();
      eventSourceRef.current = null;
      setState((prev) => ({ ...prev, connected: false }));

      const delay = getRetryDelay();
      retryCountRef.current++;
      retryTimeoutRef.current = setTimeout(connect, delay);
    };

    for (const type of eventTypesRef.current) {
      eventSource.addEventListener(type, (e) => {
        const messageEvent = e as MessageEvent;
        try {
          const data = JSON.parse(messageEvent.data) as T;
          onMessageRef.current?.(type, data);
        } catch {
          setState((prev) => ({ ...prev, error: new Error("Failed to parse SSE message") }));
        }
      });
    }

    eventSource.addEventListener("complete", () => {
      onCompleteRef.current?.();
      eventSource.close();
      eventSourceRef.current = null;
      setState({ connected: false, error: null });
    });
  }, [url, getRetryDelay]);

  useEffect(() => {
    if (!url) {
      setState({ connected: false, error: null });
      return;
    }

    connect();

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [url, connect]);

  return state;
};
