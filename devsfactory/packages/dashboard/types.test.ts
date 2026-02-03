import { describe, expect, test } from "bun:test";
import type {
  ActiveAgent,
  AgentType,
  BrainstormDraft,
  BrainstormMessage,
  BrainstormSession,
  BrainstormSessionStatus,
  Plan,
  ServerEvent,
  Subtask,
  SubtaskPreview,
  SubtaskStatus,
  Task,
  TaskPreview,
  TaskStatus
} from "./types";

describe("types", () => {
  test("TaskStatus includes expected values", () => {
    const statuses: TaskStatus[] = [
      "DRAFT",
      "BACKLOG",
      "PENDING",
      "INPROGRESS",
      "BLOCKED",
      "REVIEW",
      "DONE"
    ];
    expect(statuses).toHaveLength(7);
  });

  test("SubtaskStatus includes expected values", () => {
    const statuses: SubtaskStatus[] = [
      "PENDING",
      "INPROGRESS",
      "AGENT_REVIEW",
      "PENDING_MERGE",
      "MERGE_CONFLICT",
      "DONE",
      "BLOCKED"
    ];
    expect(statuses).toHaveLength(7);
  });

  test("AgentType includes expected values", () => {
    const types: AgentType[] = [
      "planning",
      "implementation",
      "review",
      "completing-task",
      "completion-review",
      "conflict-solver"
    ];
    expect(types).toHaveLength(6);
  });

  test("Task has required fields", () => {
    const task: Task = {
      folder: "test-task",
      frontmatter: {
        title: "Test Task",
        status: "PENDING",
        created: new Date(),
        priority: "high",
        tags: [],
        assignee: null,
        dependencies: []
      },
      description: "A test task",
      requirements: "Some requirements",
      acceptanceCriteria: [{ text: "Criterion 1", checked: false }]
    };
    expect(task.folder).toBe("test-task");
  });

  test("Subtask has required fields", () => {
    const subtask: Subtask = {
      filename: "001-test.md",
      number: 1,
      slug: "test",
      frontmatter: {
        title: "Test Subtask",
        status: "PENDING",
        dependencies: []
      },
      description: "A test subtask"
    };
    expect(subtask.number).toBe(1);
  });

  test("Plan has required fields", () => {
    const plan: Plan = {
      folder: "test-task",
      frontmatter: {
        status: "INPROGRESS",
        task: "test-task",
        created: new Date()
      },
      subtasks: [{ number: 1, slug: "setup", title: "Setup", dependencies: [] }]
    };
    expect(plan.folder).toBe("test-task");
  });

  test("ActiveAgent has required fields", () => {
    const agent: ActiveAgent = {
      taskFolder: "test-task",
      subtaskFile: "001-test.md",
      type: "implementation"
    };
    expect(agent.taskFolder).toBe("test-task");
  });

  test("ServerEvent state type", () => {
    const event: ServerEvent = {
      type: "state",
      data: { tasks: [], plans: {}, subtasks: {} }
    };
    expect(event.type).toBe("state");
  });

  test("ServerEvent taskChanged type", () => {
    const task: Task = {
      folder: "test",
      frontmatter: {
        title: "Test",
        status: "PENDING",
        created: new Date(),
        priority: "medium",
        tags: [],
        assignee: null,
        dependencies: []
      },
      description: "",
      requirements: "",
      acceptanceCriteria: []
    };
    const event: ServerEvent = { type: "taskChanged", task };
    expect(event.type).toBe("taskChanged");
  });

  test("ServerEvent subtaskChanged type", () => {
    const subtask: Subtask = {
      filename: "001-test.md",
      number: 1,
      slug: "test",
      frontmatter: { title: "Test", status: "PENDING", dependencies: [] },
      description: ""
    };
    const event: ServerEvent = {
      type: "subtaskChanged",
      taskFolder: "test-task",
      subtask
    };
    expect(event.type).toBe("subtaskChanged");
  });

  test("ServerEvent taskCreateStarted type", () => {
    const event: ServerEvent = {
      type: "taskCreateStarted",
      runId: "run-1",
      projectName: "my-project",
      description: "Add auth"
    };
    expect(event.type).toBe("taskCreateStarted");
  });

  test("ServerEvent taskCreateOutput type", () => {
    const event: ServerEvent = {
      type: "taskCreateOutput",
      runId: "run-1",
      stream: "stdout",
      line: "Creating task..."
    };
    expect(event.type).toBe("taskCreateOutput");
  });

  test("ServerEvent taskCreateCompleted type", () => {
    const event: ServerEvent = {
      type: "taskCreateCompleted",
      runId: "run-1",
      exitCode: 0
    };
    expect(event.type).toBe("taskCreateCompleted");
  });

  test("ServerEvent agentStarted type", () => {
    const event: ServerEvent = {
      type: "agentStarted",
      agentId: "agent-1",
      taskFolder: "test-task",
      subtaskFile: "001-test.md",
      agentType: "implementation"
    };
    expect(event.type).toBe("agentStarted");
  });

  test("ServerEvent agentOutput type", () => {
    const event: ServerEvent = {
      type: "agentOutput",
      agentId: "agent-1",
      chunk: "some output"
    };
    expect(event.type).toBe("agentOutput");
  });

  test("ServerEvent agentCompleted type", () => {
    const event: ServerEvent = {
      type: "agentCompleted",
      agentId: "agent-1",
      exitCode: 0
    };
    expect(event.type).toBe("agentCompleted");
  });

  test("ServerEvent jobFailed type", () => {
    const event: ServerEvent = {
      type: "jobFailed",
      jobId: "job-1",
      error: "Something failed",
      attempt: 1
    };
    expect(event.type).toBe("jobFailed");
  });

  test("ServerEvent jobRetrying type", () => {
    const event: ServerEvent = {
      type: "jobRetrying",
      jobId: "job-1",
      attempt: 2,
      nextRetryMs: 4000
    };
    expect(event.type).toBe("jobRetrying");
  });

  test("ServerEvent brainstormStarted type", () => {
    const event: ServerEvent = {
      type: "brainstormStarted",
      sessionId: "session-1",
      agentId: "agent-1"
    };
    expect(event.type).toBe("brainstormStarted");
  });

  test("ServerEvent brainstormMessage type", () => {
    const message: BrainstormMessage = {
      id: "msg-1",
      role: "assistant",
      content: "Hello, what feature would you like to build?",
      timestamp: new Date()
    };
    const event: ServerEvent = {
      type: "brainstormMessage",
      sessionId: "session-1",
      message
    };
    expect(event.type).toBe("brainstormMessage");
  });

  test("ServerEvent brainstormComplete type", () => {
    const taskPreview: TaskPreview = {
      title: "User Auth",
      description: "Add authentication",
      requirements: "OAuth",
      acceptanceCriteria: ["Login works"]
    };
    const event: ServerEvent = {
      type: "brainstormComplete",
      sessionId: "session-1",
      taskPreview
    };
    expect(event.type).toBe("brainstormComplete");
  });

  test("ServerEvent planGenerated type", () => {
    const subtaskPreviews: SubtaskPreview[] = [
      { title: "Setup", description: "Initial setup", dependencies: [] },
      { title: "Login", description: "Login form", dependencies: [1] }
    ];
    const event: ServerEvent = {
      type: "planGenerated",
      sessionId: "session-1",
      subtaskPreviews
    };
    expect(event.type).toBe("planGenerated");
  });

  test("ServerEvent taskCreated type", () => {
    const event: ServerEvent = {
      type: "taskCreated",
      sessionId: "session-1",
      taskFolder: "user-authentication"
    };
    expect(event.type).toBe("taskCreated");
  });

  test("ServerEvent brainstormError type", () => {
    const event: ServerEvent = {
      type: "brainstormError",
      sessionId: "session-1",
      error: "Agent failed to respond"
    };
    expect(event.type).toBe("brainstormError");
  });

  test("ServerEvent brainstormWaiting type", () => {
    const event: ServerEvent = {
      type: "brainstormWaiting",
      sessionId: "session-1"
    };
    expect(event.type).toBe("brainstormWaiting");
  });

  test("ServerEvent brainstormChunk type", () => {
    const event: ServerEvent = {
      type: "brainstormChunk",
      sessionId: "session-1",
      chunk: "partial message content"
    };
    expect(event.type).toBe("brainstormChunk");
  });
});

describe("Brainstorm types", () => {
  test("BrainstormSessionStatus includes expected values", () => {
    const statuses: BrainstormSessionStatus[] = [
      "active",
      "brainstorming",
      "planning",
      "review",
      "completed",
      "cancelled"
    ];
    expect(statuses).toHaveLength(6);
  });

  test("BrainstormMessage has required fields", () => {
    const message: BrainstormMessage = {
      id: "msg_123",
      role: "user",
      content: "I want to build a feature",
      timestamp: new Date()
    };
    expect(message.id).toBe("msg_123");
    expect(message.role).toBe("user");
    expect(message.content).toBe("I want to build a feature");
    expect(message.timestamp).toBeInstanceOf(Date);
  });

  test("BrainstormSession has required fields", () => {
    const session: BrainstormSession = {
      id: "session_abc",
      status: "brainstorming",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    expect(session.id).toBe("session_abc");
    expect(session.status).toBe("brainstorming");
  });

  test("BrainstormSession with optional fields", () => {
    const taskPreview: TaskPreview = {
      title: "Auth Feature",
      description: "Add user authentication",
      requirements: "OAuth and JWT",
      acceptanceCriteria: ["Users can login"]
    };
    const subtaskPreviews: SubtaskPreview[] = [
      { title: "Setup", description: "Initial setup", dependencies: [] }
    ];
    const session: BrainstormSession = {
      id: "session_def",
      status: "review",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      taskPreview,
      subtaskPreviews
    };
    expect(session.taskPreview?.title).toBe("Auth Feature");
    expect(session.subtaskPreviews?.[0]?.title).toBe("Setup");
  });

  test("TaskPreview has required fields", () => {
    const preview: TaskPreview = {
      title: "New Feature",
      description: "Feature description",
      requirements: "Feature requirements",
      acceptanceCriteria: ["Criterion 1", "Criterion 2"]
    };
    expect(preview.title).toBe("New Feature");
    expect(preview.acceptanceCriteria).toHaveLength(2);
  });

  test("SubtaskPreview has required fields", () => {
    const preview: SubtaskPreview = {
      title: "Subtask Title",
      description: "Subtask description",
      dependencies: [1, 2]
    };
    expect(preview.title).toBe("Subtask Title");
    expect(preview.dependencies).toEqual([1, 2]);
  });

  test("BrainstormDraft has required fields", () => {
    const draft: BrainstormDraft = {
      sessionId: "session_xyz",
      messages: [],
      partialTaskData: { title: "Partial" },
      status: "brainstorming",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    expect(draft.sessionId).toBe("session_xyz");
    expect(draft.status).toBe("brainstorming");
    expect(draft.partialTaskData.title).toBe("Partial");
  });
});
