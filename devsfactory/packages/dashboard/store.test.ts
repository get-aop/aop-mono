import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createDashboardStore } from "./store";
import type {
  OrchestratorState,
  ServerEvent,
  Subtask,
  SubtaskStatus,
  Task,
  TaskStatus
} from "./types";

const createMockTask = (
  folder: string,
  status: TaskStatus = "PENDING"
): Task => ({
  folder,
  frontmatter: {
    title: `Task ${folder}`,
    status,
    created: new Date(),
    priority: "medium",
    tags: [],
    assignee: null,
    dependencies: []
  },
  description: "",
  requirements: "",
  acceptanceCriteria: []
});

const createMockSubtask = (
  number: number,
  status: SubtaskStatus = "PENDING"
): Subtask => ({
  filename: `00${number}-test.md`,
  number,
  slug: "test",
  frontmatter: { title: `Subtask ${number}`, status, dependencies: [] },
  description: ""
});

describe("DashboardStore", () => {
  let store: ReturnType<typeof createDashboardStore>;

  beforeEach(() => {
    store = createDashboardStore();
  });

  describe("initial state", () => {
    test("has empty tasks array", () => {
      expect(store.getState().tasks).toEqual([]);
    });

    test("has empty plans record", () => {
      expect(store.getState().plans).toEqual({});
    });

    test("has empty subtasks record", () => {
      expect(store.getState().subtasks).toEqual({});
    });

    test("has empty activeAgents map", () => {
      expect(store.getState().activeAgents.size).toBe(0);
    });

    test("has empty agentOutputs map", () => {
      expect(store.getState().agentOutputs.size).toBe(0);
    });

    test("has no selected task", () => {
      expect(store.getState().selectedTask).toBeNull();
    });

    test("has no focused agent", () => {
      expect(store.getState().focusedAgent).toBeNull();
    });

    test("is not pinned", () => {
      expect(store.getState().isPinned).toBe(false);
    });

    test("debug mode is off", () => {
      expect(store.getState().debugMode).toBe(false);
    });

    test("is not connected", () => {
      expect(store.getState().connected).toBe(false);
    });
  });

  describe("selectTask", () => {
    test("sets selectedTask", () => {
      store.getState().selectTask("my-task");
      expect(store.getState().selectedTask).toBe("my-task");
    });

    test("can clear selected task with null", () => {
      store.getState().selectTask("my-task");
      store.getState().selectTask(null);
      expect(store.getState().selectedTask).toBeNull();
    });
  });

  describe("focusAgent", () => {
    test("sets focusedAgent", () => {
      store.getState().focusAgent("agent-1");
      expect(store.getState().focusedAgent).toBe("agent-1");
    });

    test("does not pin by default", () => {
      store.getState().focusAgent("agent-1");
      expect(store.getState().isPinned).toBe(false);
    });

    test("can pin when focusing", () => {
      store.getState().focusAgent("agent-1", true);
      expect(store.getState().isPinned).toBe(true);
    });
  });

  describe("clearFocus", () => {
    test("clears focusedAgent and isPinned", () => {
      store.getState().focusAgent("agent-1", true);
      store.getState().clearFocus();
      expect(store.getState().focusedAgent).toBeNull();
      expect(store.getState().isPinned).toBe(false);
    });
  });

  describe("toggleDebugMode", () => {
    test("toggles debug mode on", () => {
      store.getState().toggleDebugMode();
      expect(store.getState().debugMode).toBe(true);
    });

    test("toggles debug mode off", () => {
      store.getState().toggleDebugMode();
      store.getState().toggleDebugMode();
      expect(store.getState().debugMode).toBe(false);
    });
  });

  describe("setConnected", () => {
    test("sets connected state", () => {
      store.getState().setConnected(true);
      expect(store.getState().connected).toBe(true);
    });
  });

  describe("updateFromServer", () => {
    test("handles state event", () => {
      const state: OrchestratorState = {
        tasks: [createMockTask("task-1")],
        plans: {},
        subtasks: { "task-1": [createMockSubtask(1)] }
      };
      const event: ServerEvent = { type: "state", data: state };

      store.getState().updateFromServer(event);

      expect(store.getState().tasks).toHaveLength(1);
      expect(store.getState().tasks[0].folder).toBe("task-1");
      expect(store.getState().subtasks["task-1"]).toHaveLength(1);
    });

    test("handles taskChanged event - updates existing task", () => {
      const initialState: OrchestratorState = {
        tasks: [createMockTask("task-1", "PENDING")],
        plans: {},
        subtasks: {}
      };
      store.getState().updateFromServer({ type: "state", data: initialState });

      const updatedTask = createMockTask("task-1", "INPROGRESS");
      store
        .getState()
        .updateFromServer({ type: "taskChanged", task: updatedTask });

      expect(store.getState().tasks[0].frontmatter.status).toBe("INPROGRESS");
    });

    test("handles taskChanged event - adds new task", () => {
      const newTask = createMockTask("new-task");
      store.getState().updateFromServer({ type: "taskChanged", task: newTask });

      expect(store.getState().tasks).toHaveLength(1);
      expect(store.getState().tasks[0].folder).toBe("new-task");
    });

    test("handles subtaskChanged event - updates existing subtask", () => {
      const initialState: OrchestratorState = {
        tasks: [],
        plans: {},
        subtasks: { "task-1": [createMockSubtask(1, "PENDING")] }
      };
      store.getState().updateFromServer({ type: "state", data: initialState });

      const updatedSubtask = createMockSubtask(1, "DONE");
      store.getState().updateFromServer({
        type: "subtaskChanged",
        taskFolder: "task-1",
        subtask: updatedSubtask
      });

      expect(store.getState().subtasks["task-1"][0].frontmatter.status).toBe(
        "DONE"
      );
    });

    test("handles subtaskChanged event - adds new subtask to existing folder", () => {
      const initialState: OrchestratorState = {
        tasks: [],
        plans: {},
        subtasks: { "task-1": [createMockSubtask(1)] }
      };
      store.getState().updateFromServer({ type: "state", data: initialState });

      const newSubtask = createMockSubtask(2);
      store.getState().updateFromServer({
        type: "subtaskChanged",
        taskFolder: "task-1",
        subtask: newSubtask
      });

      expect(store.getState().subtasks["task-1"]).toHaveLength(2);
    });

    test("handles subtaskChanged event - creates folder if not exists", () => {
      const newSubtask = createMockSubtask(1);
      store.getState().updateFromServer({
        type: "subtaskChanged",
        taskFolder: "new-task",
        subtask: newSubtask
      });

      expect(store.getState().subtasks["new-task"]).toHaveLength(1);
    });

    test("handles agentStarted event", () => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "task-1",
        subtaskFile: "001-test.md",
        agentType: "implementation"
      });

      const agent = store.getState().activeAgents.get("agent-1");
      expect(agent).toBeDefined();
      expect(agent?.taskFolder).toBe("task-1");
      expect(agent?.subtaskFile).toBe("001-test.md");
      expect(agent?.type).toBe("implementation");
    });

    test("handles agentOutput event", () => {
      store.getState().updateFromServer({
        type: "agentOutput",
        agentId: "agent-1",
        chunk: "Hello"
      });

      const outputs = store.getState().agentOutputs.get("agent-1");
      expect(outputs).toContain("Hello");
    });

    test("handles agentOutput event - appends to existing", () => {
      store.getState().updateFromServer({
        type: "agentOutput",
        agentId: "agent-1",
        chunk: "Hello"
      });
      store.getState().updateFromServer({
        type: "agentOutput",
        agentId: "agent-1",
        chunk: " World"
      });

      const outputs = store.getState().agentOutputs.get("agent-1");
      expect(outputs).toHaveLength(2);
      expect(outputs).toContain("Hello");
      expect(outputs).toContain(" World");
    });

    test("handles agentOutput event - limits to 1000 lines", () => {
      for (let i = 0; i < 1005; i++) {
        store.getState().updateFromServer({
          type: "agentOutput",
          agentId: "agent-1",
          chunk: `Line ${i}`
        });
      }

      const outputs = store.getState().agentOutputs.get("agent-1");
      expect(outputs).toHaveLength(1000);
      expect(outputs?.[0]).toBe("Line 5");
      expect(outputs?.[999]).toBe("Line 1004");
    });

    test("handles agentCompleted event", () => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "task-1",
        agentType: "implementation"
      });

      store.getState().updateFromServer({
        type: "agentCompleted",
        agentId: "agent-1",
        exitCode: 0
      });

      expect(store.getState().activeAgents.has("agent-1")).toBe(false);
    });

    test("handles jobFailed event (no-op, for logging)", () => {
      expect(() =>
        store.getState().updateFromServer({
          type: "jobFailed",
          jobId: "job-1",
          error: "Something failed",
          attempt: 1
        })
      ).not.toThrow();
    });

    test("handles jobRetrying event (no-op, for logging)", () => {
      expect(() =>
        store.getState().updateFromServer({
          type: "jobRetrying",
          jobId: "job-1",
          attempt: 2,
          nextRetryMs: 4000
        })
      ).not.toThrow();
    });
  });

  describe("API actions", () => {
    let originalFetch: typeof globalThis.fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("setTaskStatus calls API", async () => {
      await store.getState().setTaskStatus("task-1", "INPROGRESS");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/tasks/task-1/status");
    });

    test("setSubtaskStatus calls API", async () => {
      await store.getState().setSubtaskStatus("task-1", "001-test.md", "DONE");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/subtasks/task-1/001-test.md/status");
    });

    test("createPullRequest calls API and returns prUrl", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ prUrl: "https://github.com/org/repo/pull/1" }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const result = await store.getState().createPullRequest("task-1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.prUrl).toBe("https://github.com/org/repo/pull/1");
    });
  });
});
