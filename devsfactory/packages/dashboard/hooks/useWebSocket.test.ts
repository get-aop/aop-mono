import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, renderHook } from "@testing-library/react";
import { createDashboardStore } from "../store";
import type { ServerEvent } from "../types";
import { useWebSocket } from "./useWebSocket";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  readyState = 0;
  CONNECTING = 0;
  OPEN = 1;
  CLOSING = 2;
  CLOSED = 3;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = this.CLOSED;
    this.onclose?.({ code: 1000 });
  }

  simulateOpen() {
    this.readyState = this.OPEN;
    this.onopen?.();
  }

  simulateClose(code = 1000) {
    this.readyState = this.CLOSED;
    this.onclose?.({ code });
  }

  simulateMessage(data: ServerEvent) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError(error: Error) {
    this.onerror?.(error);
  }

  static reset() {
    MockWebSocket.instances = [];
  }

  static getLatest(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

describe("useWebSocket", () => {
  let originalWebSocket: typeof WebSocket;
  let store: ReturnType<typeof createDashboardStore>;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    MockWebSocket.reset();
    store = createDashboardStore();
    jest.useFakeTimers();
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    jest.useRealTimers();
  });

  test("connects to WebSocket on mount", () => {
    renderHook(() => useWebSocket({ store, url: "ws://test:3000/api/events" }));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://test:3000/api/events");
  });

  test("uses default URL when not provided", () => {
    renderHook(() => useWebSocket({ store }));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe(
      "ws://localhost:3000/api/events"
    );
  });

  test("sets connected=true when WebSocket opens", async () => {
    renderHook(() => useWebSocket({ store, url: "ws://test:3000/api/events" }));

    act(() => {
      MockWebSocket.getLatest()?.simulateOpen();
    });

    expect(store.getState().connected).toBe(true);
  });

  test("sets connected=false when WebSocket closes", async () => {
    renderHook(() => useWebSocket({ store, url: "ws://test:3000/api/events" }));

    act(() => {
      MockWebSocket.getLatest()?.simulateOpen();
    });
    expect(store.getState().connected).toBe(true);

    act(() => {
      MockWebSocket.getLatest()?.simulateClose();
    });
    expect(store.getState().connected).toBe(false);
  });

  test("calls store.updateFromServer when message received", async () => {
    const updateSpy = mock(() => {});
    const originalUpdate = store.getState().updateFromServer;
    store.setState({ updateFromServer: updateSpy });

    renderHook(() => useWebSocket({ store, url: "ws://test:3000/api/events" }));

    act(() => {
      MockWebSocket.getLatest()?.simulateOpen();
      MockWebSocket.getLatest()?.simulateMessage({
        type: "state",
        data: { tasks: [], plans: {}, subtasks: {} }
      });
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    store.setState({ updateFromServer: originalUpdate });
  });

  test("closes WebSocket on unmount", () => {
    const { unmount } = renderHook(() =>
      useWebSocket({ store, url: "ws://test:3000/api/events" })
    );

    act(() => {
      MockWebSocket.getLatest()?.simulateOpen();
    });

    unmount();

    expect(MockWebSocket.getLatest()?.readyState).toBe(
      MockWebSocket.getLatest()?.CLOSED
    );
  });

  describe("auto-reconnect", () => {
    test("reconnects after close with backoff starting at 1s", async () => {
      renderHook(() =>
        useWebSocket({ store, url: "ws://test:3000/api/events" })
      );

      act(() => {
        MockWebSocket.getLatest()?.simulateOpen();
        MockWebSocket.getLatest()?.simulateClose(1006);
      });

      expect(MockWebSocket.instances).toHaveLength(1);

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(MockWebSocket.instances).toHaveLength(2);
    });

    test("increases backoff when connection fails without opening", async () => {
      renderHook(() =>
        useWebSocket({ store, url: "ws://test:3000/api/events" })
      );

      // First connection fails immediately (no open)
      act(() => {
        MockWebSocket.getLatest()?.simulateClose(1006);
      });

      // Wait less than 1s - no reconnect yet
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(MockWebSocket.instances).toHaveLength(1);

      // After 1s total - reconnect happens
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(MockWebSocket.instances).toHaveLength(2);

      // Second connection also fails immediately
      act(() => {
        MockWebSocket.getLatest()?.simulateClose(1006);
      });

      // Wait 1.5s - should not reconnect yet (need 2s due to backoff)
      act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(MockWebSocket.instances).toHaveLength(2);

      // After 0.5s more (total 2s) - reconnect happens
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(MockWebSocket.instances).toHaveLength(3);
    });

    test("caps backoff at 30s", async () => {
      renderHook(() =>
        useWebSocket({ store, url: "ws://test:3000/api/events" })
      );

      // Simulate many failed reconnects (no open) to reach max backoff
      // Backoff sequence: 1s, 2s, 4s, 8s, 16s, 30s (capped)
      for (let i = 0; i < 6; i++) {
        act(() => {
          MockWebSocket.getLatest()?.simulateClose(1006);
          jest.advanceTimersByTime(30000);
        });
      }

      const lastInstance = MockWebSocket.instances.length;

      act(() => {
        MockWebSocket.getLatest()?.simulateClose(1006);
      });

      // Should wait max 30s
      act(() => {
        jest.advanceTimersByTime(29999);
      });
      expect(MockWebSocket.instances).toHaveLength(lastInstance);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(MockWebSocket.instances).toHaveLength(lastInstance + 1);
    });

    test("resets backoff on successful connection", async () => {
      renderHook(() =>
        useWebSocket({ store, url: "ws://test:3000/api/events" })
      );

      // Cause a few reconnects
      act(() => {
        MockWebSocket.getLatest()?.simulateOpen();
        MockWebSocket.getLatest()?.simulateClose(1006);
        jest.advanceTimersByTime(1000);
      });

      act(() => {
        MockWebSocket.getLatest()?.simulateOpen();
        MockWebSocket.getLatest()?.simulateClose(1006);
        jest.advanceTimersByTime(2000);
      });

      // Now connect successfully
      act(() => {
        MockWebSocket.getLatest()?.simulateOpen();
      });

      // Close again - should use initial 1s backoff
      act(() => {
        MockWebSocket.getLatest()?.simulateClose(1006);
      });

      const instancesBeforeReconnect = MockWebSocket.instances.length;

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(MockWebSocket.instances).toHaveLength(
        instancesBeforeReconnect + 1
      );
    });

    test("does not reconnect on normal close (code 1000)", async () => {
      renderHook(() =>
        useWebSocket({ store, url: "ws://test:3000/api/events" })
      );

      act(() => {
        MockWebSocket.getLatest()?.simulateOpen();
        MockWebSocket.getLatest()?.simulateClose(1000);
      });

      act(() => {
        jest.advanceTimersByTime(30000);
      });

      expect(MockWebSocket.instances).toHaveLength(1);
    });
  });
});
