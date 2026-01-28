import { describe, expect, test } from "bun:test";
import type {
  ActiveAgent,
  AgentType,
  Plan,
  ServerEvent,
  Subtask,
  SubtaskStatus,
  Task,
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
});
