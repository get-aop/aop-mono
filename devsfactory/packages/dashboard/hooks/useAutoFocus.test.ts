import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, renderHook } from "@testing-library/react";
import { createDashboardStore } from "../store";
import { useAutoFocus } from "./useAutoFocus";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("useAutoFocus", () => {
  let store: ReturnType<typeof createDashboardStore>;

  beforeEach(() => {
    store = createDashboardStore();
  });

  test("auto-focuses on first active agent when not pinned", () => {
    renderHook(() => useAutoFocus({ store }));

    act(() => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "task-1",
        agentType: "implementation"
      });
    });

    expect(store.getState().focusedAgent).toBe("agent-1");
  });

  test("switches focus to new agent when not pinned", () => {
    renderHook(() => useAutoFocus({ store }));

    act(() => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "task-1",
        agentType: "implementation"
      });
    });
    expect(store.getState().focusedAgent).toBe("agent-1");

    act(() => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-2",
        taskFolder: "task-2",
        agentType: "review"
      });
    });
    expect(store.getState().focusedAgent).toBe("agent-2");
  });

  test("does not switch focus when pinned", () => {
    renderHook(() => useAutoFocus({ store }));

    act(() => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "task-1",
        agentType: "implementation"
      });
      store.getState().focusAgent("agent-1", true);
    });
    expect(store.getState().focusedAgent).toBe("agent-1");
    expect(store.getState().isPinned).toBe(true);

    act(() => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-2",
        taskFolder: "task-2",
        agentType: "review"
      });
    });

    expect(store.getState().focusedAgent).toBe("agent-1");
  });

  test("clears focus when focused agent completes and not pinned", () => {
    renderHook(() => useAutoFocus({ store }));

    act(() => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "task-1",
        agentType: "implementation"
      });
    });
    expect(store.getState().focusedAgent).toBe("agent-1");

    act(() => {
      store.getState().updateFromServer({
        type: "agentCompleted",
        agentId: "agent-1",
        exitCode: 0
      });
    });

    expect(store.getState().focusedAgent).toBeNull();
  });

  test("focuses on next active agent when current agent completes", () => {
    renderHook(() => useAutoFocus({ store }));

    act(() => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "task-1",
        agentType: "implementation"
      });
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-2",
        taskFolder: "task-2",
        agentType: "review"
      });
    });

    // Should be focused on agent-2 (latest)
    expect(store.getState().focusedAgent).toBe("agent-2");

    act(() => {
      store.getState().updateFromServer({
        type: "agentCompleted",
        agentId: "agent-2",
        exitCode: 0
      });
    });

    // Should fall back to agent-1
    expect(store.getState().focusedAgent).toBe("agent-1");
  });

  test("keeps pinned focus even when agent completes", () => {
    renderHook(() => useAutoFocus({ store }));

    act(() => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "task-1",
        agentType: "implementation"
      });
      store.getState().focusAgent("agent-1", true);
    });

    act(() => {
      store.getState().updateFromServer({
        type: "agentCompleted",
        agentId: "agent-1",
        exitCode: 0
      });
    });

    // Pinned focus is kept even though agent completed
    expect(store.getState().focusedAgent).toBe("agent-1");
    expect(store.getState().isPinned).toBe(true);
  });
});
