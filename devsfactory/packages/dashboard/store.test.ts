import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createDashboardStore } from "./store";
import type {
  BrainstormDraft,
  BrainstormMessage,
  OrchestratorState,
  ServerEvent,
  Subtask,
  SubtaskPreview,
  SubtaskStatus,
  Task,
  TaskPreview,
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
      const newTask = createMockTask("create-task");
      store.getState().updateFromServer({ type: "taskChanged", task: newTask });

      expect(store.getState().tasks).toHaveLength(1);
      expect(store.getState().tasks[0].folder).toBe("create-task");
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
        taskFolder: "create-task",
        subtask: newSubtask
      });

      expect(store.getState().subtasks["create-task"]).toHaveLength(1);
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
      store.getState().selectProject("test-project");
      await store.getState().setTaskStatus("task-1", "INPROGRESS");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/tasks/task-1/status");
    });

    test("setSubtaskStatus calls API", async () => {
      store.getState().selectProject("test-project");
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

  describe("selectSubtask", () => {
    let originalFetch: typeof globalThis.fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("sets selectedSubtask and loads logs", async () => {
      const mockLogs = { logs: ["Log line 1", "Log line 2"] };
      mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify(mockLogs), { status: 200 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await store.getState().selectSubtask("my-task", "001-first-subtask.md");

      const state = store.getState();
      expect(state.selectedSubtask).toEqual({
        taskFolder: "my-task",
        subtaskFile: "001-first-subtask.md"
      });
      expect(state.subtaskLogs).toEqual(mockLogs.logs);
      expect(state.subtaskLogsLoading).toBe(false);
    });

    test("sets loading state while fetching logs", async () => {
      let resolvePromise: (value: Response) => void;
      const pendingPromise = new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });

      mockFetch = mock(() => pendingPromise);
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const selectPromise = store
        .getState()
        .selectSubtask("my-task", "001-first-subtask.md");

      expect(store.getState().subtaskLogsLoading).toBe(true);
      expect(store.getState().selectedSubtask).toEqual({
        taskFolder: "my-task",
        subtaskFile: "001-first-subtask.md"
      });

      resolvePromise!(
        new Response(JSON.stringify({ logs: ["line1"] }), { status: 200 })
      );
      await selectPromise;

      expect(store.getState().subtaskLogsLoading).toBe(false);
    });

    test("clears logs on fetch error", async () => {
      mockFetch = mock(() =>
        Promise.resolve(new Response("Not Found", { status: 404 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await store.getState().selectSubtask("my-task", "001-first-subtask.md");

      const state = store.getState();
      expect(state.selectedSubtask).toEqual({
        taskFolder: "my-task",
        subtaskFile: "001-first-subtask.md"
      });
      expect(state.subtaskLogs).toEqual([]);
      expect(state.subtaskLogsLoading).toBe(false);
    });
  });

  describe("clearSubtaskSelection", () => {
    let originalFetch: typeof globalThis.fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ logs: ["line1", "line2"] }), {
            status: 200
          })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("clears selectedSubtask and related state", async () => {
      await store.getState().selectSubtask("my-task", "001-subtask.md");
      expect(store.getState().selectedSubtask).not.toBeNull();

      store.getState().clearSubtaskSelection();

      const state = store.getState();
      expect(state.selectedSubtask).toBeNull();
      expect(state.subtaskLogs).toEqual([]);
      expect(state.subtaskLogsLoading).toBe(false);
    });
  });

  describe("real-time log updates for selected subtask", () => {
    let originalFetch: typeof globalThis.fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ logs: ["initial log"] }), {
            status: 200
          })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("appends logs for selected subtask when agentOutput matches", async () => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "my-task",
        subtaskFile: "001-subtask.md",
        agentType: "implementation"
      });

      await store.getState().selectSubtask("my-task", "001-subtask.md");

      store.getState().updateFromServer({
        type: "agentOutput",
        agentId: "agent-1",
        chunk: "new real-time log"
      });

      const state = store.getState();
      expect(state.subtaskLogs).toEqual(["initial log", "new real-time log"]);
    });

    test("does not append logs for unrelated agent", async () => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "other-task",
        subtaskFile: "002-other-subtask.md",
        agentType: "implementation"
      });

      await store.getState().selectSubtask("my-task", "001-subtask.md");

      store.getState().updateFromServer({
        type: "agentOutput",
        agentId: "agent-1",
        chunk: "log from other task"
      });

      const state = store.getState();
      expect(state.subtaskLogs).toEqual(["initial log"]);
    });

    test("does not append logs when no subtask is selected", () => {
      store.getState().updateFromServer({
        type: "agentStarted",
        agentId: "agent-1",
        taskFolder: "my-task",
        subtaskFile: "001-subtask.md",
        agentType: "implementation"
      });

      store.getState().updateFromServer({
        type: "agentOutput",
        agentId: "agent-1",
        chunk: "some log"
      });

      expect(store.getState().subtaskLogs).toEqual([]);
    });
  });

  describe("brainstorm initial state", () => {
    test("has null activeSession", () => {
      expect(store.getState().brainstorm.activeSession).toBeNull();
    });

    test("has idle sessionStatus", () => {
      expect(store.getState().brainstorm.sessionStatus).toBe("idle");
    });

    test("has empty messages array", () => {
      expect(store.getState().brainstorm.messages).toEqual([]);
    });

    test("isWaitingForAgent is false", () => {
      expect(store.getState().brainstorm.isWaitingForAgent).toBe(false);
    });

    test("has null taskPreview", () => {
      expect(store.getState().brainstorm.taskPreview).toBeNull();
    });

    test("has empty subtaskPreviews", () => {
      expect(store.getState().brainstorm.subtaskPreviews).toEqual([]);
    });

    test("has empty editedSubtasks", () => {
      expect(store.getState().brainstorm.editedSubtasks).toEqual([]);
    });

    test("has empty drafts", () => {
      expect(store.getState().brainstorm.drafts).toEqual([]);
    });

    test("draftsLoading is false", () => {
      expect(store.getState().brainstorm.draftsLoading).toBe(false);
    });

    test("isModalOpen is false", () => {
      expect(store.getState().brainstorm.isModalOpen).toBe(false);
    });

    test("currentStep is drafts", () => {
      expect(store.getState().brainstorm.currentStep).toBe("drafts");
    });

    test("error is null", () => {
      expect(store.getState().brainstorm.error).toBeNull();
    });
  });

  describe("brainstorm modal actions", () => {
    test("openModal sets isModalOpen to true", () => {
      store.getState().openModal();
      expect(store.getState().brainstorm.isModalOpen).toBe(true);
    });

    test("closeModal sets isModalOpen to false", async () => {
      store.getState().openModal();
      await store.getState().closeModal();
      expect(store.getState().brainstorm.isModalOpen).toBe(false);
    });

    test("closeModal resets brainstorm state", async () => {
      store.getState().openModal();
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });
      await store.getState().closeModal();

      const state = store.getState().brainstorm;
      expect(state.isModalOpen).toBe(false);
      expect(state.activeSession).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.sessionStatus).toBe("idle");
      expect(state.currentStep).toBe("drafts");
    });
  });

  describe("brainstorm session actions", () => {
    let originalFetch: typeof globalThis.fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ sessionId: "session-1", agentId: "agent-1" }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("startSession calls API and sets sessionStatus to starting", async () => {
      const promise = store.getState().startSession("Help me build a feature");

      expect(store.getState().brainstorm.sessionStatus).toBe("starting");

      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/brainstorm/start");
      expect(JSON.parse(options.body)).toEqual({
        initialMessage: "Help me build a feature"
      });
    });

    test("startSession sets currentStep to brainstorm", async () => {
      await store.getState().startSession();
      expect(store.getState().brainstorm.currentStep).toBe("brainstorm");
    });

    test("resumeSession calls API with draft sessionId", async () => {
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ sessionId: "draft-session", agentId: "agent-2" }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await store.getState().resumeSession("draft-session");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/brainstorm/drafts/draft-session/resume");
    });

    test("sendMessage calls API and sets isWaitingForAgent", async () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      const promise = store.getState().sendMessage("My requirements");

      expect(store.getState().brainstorm.isWaitingForAgent).toBe(true);

      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/brainstorm/session-1/message");
      expect(JSON.parse(options.body)).toEqual({ content: "My requirements" });
    });

    test("sendMessage adds user message to messages array", async () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      await store.getState().sendMessage("My requirements");

      const messages = store.getState().brainstorm.messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("My requirements");
    });

    test("endSession calls API", async () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ draftId: "draft-1" }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await store.getState().endSession();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/brainstorm/session-1/end");
    });
  });

  describe("brainstorm planning actions", () => {
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

    test("confirmTaskPreview calls API and sets sessionStatus to planning", async () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });
      const taskPreview: TaskPreview = {
        title: "My Task",
        description: "Description",
        requirements: "Requirements",
        acceptanceCriteria: ["Criterion 1"]
      };
      store.getState().updateFromServer({
        type: "brainstormComplete",
        sessionId: "session-1",
        taskPreview
      });

      const promise = store.getState().confirmTaskPreview();
      expect(store.getState().brainstorm.sessionStatus).toBe("planning");

      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/brainstorm/session-1/confirm");
    });
  });

  describe("brainstorm editing actions", () => {
    test("updateSubtask modifies editedSubtasks at index", () => {
      const subtasks: SubtaskPreview[] = [
        { title: "Subtask 1", description: "Desc 1", dependencies: [] },
        { title: "Subtask 2", description: "Desc 2", dependencies: [1] }
      ];
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });
      store.getState().updateFromServer({
        type: "planGenerated",
        sessionId: "session-1",
        subtaskPreviews: subtasks
      });

      store.getState().updateSubtask(0, { title: "Updated Title" });

      const edited = store.getState().brainstorm.editedSubtasks;
      expect(edited[0].title).toBe("Updated Title");
      expect(edited[0].description).toBe("Desc 1");
      expect(edited[1].title).toBe("Subtask 2");
    });

    test("reorderSubtasks moves subtask from one index to another", () => {
      const subtasks: SubtaskPreview[] = [
        { title: "A", description: "", dependencies: [] },
        { title: "B", description: "", dependencies: [] },
        { title: "C", description: "", dependencies: [] }
      ];
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });
      store.getState().updateFromServer({
        type: "planGenerated",
        sessionId: "session-1",
        subtaskPreviews: subtasks
      });

      store.getState().reorderSubtasks(0, 2);

      const edited = store.getState().brainstorm.editedSubtasks;
      expect(edited[0].title).toBe("B");
      expect(edited[1].title).toBe("C");
      expect(edited[2].title).toBe("A");
    });
  });

  describe("brainstorm approval actions", () => {
    let originalFetch: typeof globalThis.fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ taskFolder: "my-create-task" }), {
            status: 200
          })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("approveAndCreate calls API with edited subtasks", async () => {
      const subtasks: SubtaskPreview[] = [
        { title: "Subtask 1", description: "Desc", dependencies: [] }
      ];
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });
      store.getState().updateFromServer({
        type: "brainstormComplete",
        sessionId: "session-1",
        taskPreview: {
          title: "Task",
          description: "Desc",
          requirements: "Req",
          acceptanceCriteria: []
        }
      });
      store.getState().updateFromServer({
        type: "planGenerated",
        sessionId: "session-1",
        subtaskPreviews: subtasks
      });

      store.getState().updateSubtask(0, { title: "Edited Subtask" });
      await store.getState().approveAndCreate();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/brainstorm/session-1/approve");
      const body = JSON.parse(options.body);
      expect(body.subtasks[0].title).toBe("Edited Subtask");
    });

    test("approveAndCreate sets sessionStatus to creating", async () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });
      store.getState().updateFromServer({
        type: "brainstormComplete",
        sessionId: "session-1",
        taskPreview: {
          title: "Task",
          description: "Desc",
          requirements: "Req",
          acceptanceCriteria: []
        }
      });
      store.getState().updateFromServer({
        type: "planGenerated",
        sessionId: "session-1",
        subtaskPreviews: []
      });

      const promise = store.getState().approveAndCreate();
      expect(store.getState().brainstorm.sessionStatus).toBe("creating");

      await promise;
    });
  });

  describe("brainstorm draft actions", () => {
    let originalFetch: typeof globalThis.fetch;
    let mockFetch: ReturnType<typeof mock>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test("loadDrafts fetches drafts and updates state", async () => {
      const drafts: BrainstormDraft[] = [
        {
          sessionId: "draft-1",
          messages: [],
          partialTaskData: { title: "Draft Task" },
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ drafts }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      store.getState().openModal();
      const promise = store.getState().loadDrafts();
      expect(store.getState().brainstorm.draftsLoading).toBe(true);

      await promise;

      expect(store.getState().brainstorm.drafts).toHaveLength(1);
      expect(store.getState().brainstorm.drafts[0].sessionId).toBe("draft-1");
      expect(store.getState().brainstorm.draftsLoading).toBe(false);
    });

    test("deleteDraft calls API and removes draft from state", async () => {
      const drafts: BrainstormDraft[] = [
        {
          sessionId: "draft-1",
          messages: [],
          partialTaskData: {},
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          sessionId: "draft-2",
          messages: [],
          partialTaskData: {},
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ drafts }), { status: 200 })
        )
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await store.getState().loadDrafts();

      mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      );
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      await store.getState().deleteDraft("draft-1");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/api/brainstorm/drafts/draft-1");
      expect(options.method).toBe("DELETE");
      expect(store.getState().brainstorm.drafts).toHaveLength(1);
      expect(store.getState().brainstorm.drafts[0].sessionId).toBe("draft-2");
    });
  });

  describe("brainstorm WebSocket event handling", () => {
    test("handles brainstormStarted event", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      const state = store.getState().brainstorm;
      expect(state.activeSession).toBe("session-1");
      expect(state.sessionStatus).toBe("brainstorming");
      expect(state.isWaitingForAgent).toBe(true);
    });

    test("handles brainstormMessage event", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      const message: BrainstormMessage = {
        id: "msg-1",
        role: "assistant",
        content: "Hello! What would you like to build?",
        timestamp: new Date()
      };

      store.getState().updateFromServer({
        type: "brainstormMessage",
        sessionId: "session-1",
        message
      });

      const state = store.getState().brainstorm;
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].content).toBe(
        "Hello! What would you like to build?"
      );
      expect(state.isWaitingForAgent).toBe(false);
    });

    test("handles brainstormComplete event", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      const taskPreview: TaskPreview = {
        title: "New Feature",
        description: "A new feature",
        requirements: "Must do X",
        acceptanceCriteria: ["X works"]
      };

      store.getState().updateFromServer({
        type: "brainstormComplete",
        sessionId: "session-1",
        taskPreview
      });

      const state = store.getState().brainstorm;
      expect(state.taskPreview).toEqual(taskPreview);
      expect(state.sessionStatus).toBe("review");
      expect(state.currentStep).toBe("review");
    });

    test("handles planGenerated event", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      const subtaskPreviews: SubtaskPreview[] = [
        { title: "Setup", description: "Set up project", dependencies: [] },
        {
          title: "Implement",
          description: "Implement feature",
          dependencies: [1]
        }
      ];

      store.getState().updateFromServer({
        type: "planGenerated",
        sessionId: "session-1",
        subtaskPreviews
      });

      const state = store.getState().brainstorm;
      expect(state.subtaskPreviews).toEqual(subtaskPreviews);
      expect(state.editedSubtasks).toEqual(subtaskPreviews);
      expect(state.currentStep).toBe("approve");
    });

    test("handles taskCreated event", () => {
      store.getState().openModal();
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "taskCreated",
        sessionId: "session-1",
        taskFolder: "my-create-task"
      });

      const state = store.getState().brainstorm;
      expect(state.sessionStatus).toBe("idle");
      expect(state.isModalOpen).toBe(false);
    });

    test("handles brainstormError event", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "brainstormError",
        sessionId: "session-1",
        error: "Something went wrong"
      });

      const state = store.getState().brainstorm;
      expect(state.error).toBe("Something went wrong");
      expect(state.isWaitingForAgent).toBe(false);
    });

    test("ignores brainstorm events for different session", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "brainstormMessage",
        sessionId: "different-session",
        message: {
          id: "msg-1",
          role: "assistant",
          content: "Should be ignored",
          timestamp: new Date()
        }
      });

      expect(store.getState().brainstorm.messages).toHaveLength(0);
    });

    test("handles brainstormWaiting event", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "brainstormWaiting",
        sessionId: "session-1"
      });

      const state = store.getState().brainstorm;
      expect(state.isWaitingForAgent).toBe(false);
    });

    test("handles brainstormChunk event - accumulates streaming content", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "brainstormChunk",
        sessionId: "session-1",
        chunk: "Hello"
      });

      expect(store.getState().brainstorm.streamingMessage).toBe("Hello");

      store.getState().updateFromServer({
        type: "brainstormChunk",
        sessionId: "session-1",
        chunk: " World"
      });

      expect(store.getState().brainstorm.streamingMessage).toBe("Hello World");
    });

    test("brainstormMessage clears streamingMessage", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "brainstormChunk",
        sessionId: "session-1",
        chunk: "Streaming content"
      });

      expect(store.getState().brainstorm.streamingMessage).toBe(
        "Streaming content"
      );

      const message: BrainstormMessage = {
        id: "msg-1",
        role: "assistant",
        content: "Complete message",
        timestamp: new Date()
      };

      store.getState().updateFromServer({
        type: "brainstormMessage",
        sessionId: "session-1",
        message
      });

      expect(store.getState().brainstorm.streamingMessage).toBeNull();
      expect(store.getState().brainstorm.messages).toHaveLength(1);
    });

    test("ignores brainstormWaiting for different session", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "brainstormWaiting",
        sessionId: "different-session"
      });

      expect(store.getState().brainstorm.isWaitingForAgent).toBe(true);
    });

    test("ignores brainstormChunk for different session", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "brainstormChunk",
        sessionId: "different-session",
        chunk: "Should be ignored"
      });

      expect(store.getState().brainstorm.streamingMessage).toBeNull();
    });
  });

  describe("brainstorm streamingMessage state", () => {
    test("initial streamingMessage is null", () => {
      expect(store.getState().brainstorm.streamingMessage).toBeNull();
    });

    test("closeModal resets streamingMessage", async () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "brainstormChunk",
        sessionId: "session-1",
        chunk: "Some streaming content"
      });

      await store.getState().closeModal();

      expect(store.getState().brainstorm.streamingMessage).toBeNull();
    });

    test("taskCreated event resets streamingMessage", () => {
      store.getState().updateFromServer({
        type: "brainstormStarted",
        sessionId: "session-1",
        agentId: "agent-1"
      });

      store.getState().updateFromServer({
        type: "brainstormChunk",
        sessionId: "session-1",
        chunk: "Streaming content"
      });

      store.getState().updateFromServer({
        type: "taskCreated",
        sessionId: "session-1",
        taskFolder: "my-task"
      });

      expect(store.getState().brainstorm.streamingMessage).toBeNull();
    });
  });
});

describe("Project State", () => {
  let store: ReturnType<typeof createDashboardStore>;

  beforeEach(() => {
    store = createDashboardStore();
  });

  test("initializes with default project state", () => {
    const state = store.getState();
    expect(state.project.projects).toEqual([]);
    expect(state.project.isGlobalMode).toBe(false);
    expect(state.project.currentProject).toBeNull();
    expect(state.project.projectsLoading).toBe(false);
    expect(state.project.projectsError).toBeNull();
  });

  test("can be initialized with custom project state", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "test", path: "/test", registered: new Date(), taskCount: 2 }
        ],
        isGlobalMode: true,
        currentProject: "test",
        projectsLoading: false,
        projectsError: null
      }
    });

    const state = store.getState();
    expect(state.project.projects).toHaveLength(1);
    expect(state.project.isGlobalMode).toBe(true);
    expect(state.project.currentProject).toBe("test");
  });

  test("selectProject updates currentProject", () => {
    store.getState().selectProject("my-project");
    expect(store.getState().project.currentProject).toBe("my-project");
  });

  test("selectProject clears selectedTask and selectedSubtask", () => {
    store = createDashboardStore(undefined, {
      selectedTask: "task-1",
      selectedSubtask: { taskFolder: "task-1", subtaskFile: "001-sub.md" }
    });

    store.getState().selectProject("my-project");

    expect(store.getState().selectedTask).toBeNull();
    expect(store.getState().selectedSubtask).toBeNull();
  });

  test("selectAllProjects sets currentProject to null", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [],
        isGlobalMode: true,
        currentProject: "some-project",
        projectsLoading: false,
        projectsError: null
      }
    });

    store.getState().selectAllProjects();
    expect(store.getState().project.currentProject).toBeNull();
  });

  test("loadProjects sets loading state", async () => {
    const mockClient = {
      fetchProjects: mock(async () => ({
        projects: [
          { name: "p1", path: "/p1", registered: new Date(), taskCount: 1 }
        ],
        isGlobalMode: true
      }))
    };

    store = createDashboardStore(mockClient as any);
    const loadPromise = store.getState().loadProjects();

    expect(store.getState().project.projectsLoading).toBe(true);

    await loadPromise;

    expect(store.getState().project.projectsLoading).toBe(false);
    expect(store.getState().project.projects).toHaveLength(1);
    expect(store.getState().project.isGlobalMode).toBe(true);
  });

  test("loadProjects handles errors", async () => {
    const mockClient = {
      fetchProjects: mock(async () => {
        throw new Error("Network error");
      })
    };

    store = createDashboardStore(mockClient as any);
    await store.getState().loadProjects();

    expect(store.getState().project.projectsLoading).toBe(false);
    expect(store.getState().project.projectsError).toBe("Network error");
  });
});
