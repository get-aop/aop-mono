import { describe, expect, it } from "bun:test";
import {
  createMockTask,
  createMockSubtask,
  createMockPlan,
  createMockOrchestratorState
} from "./test-helpers";

describe("createMockTask", () => {
  it("creates a task with default values", () => {
    const task = createMockTask();

    expect(task.folder).toBe("test-task");
    expect(task.frontmatter.title).toBe("Test Task");
    expect(task.frontmatter.status).toBe("PENDING");
    expect(task.frontmatter.priority).toBe("medium");
    expect(task.frontmatter.tags).toEqual([]);
    expect(task.acceptanceCriteria).toHaveLength(2);
  });

  it("allows overriding task properties", () => {
    const task = createMockTask({
      folder: "custom-folder",
      title: "Custom Task",
      status: "INPROGRESS",
      priority: "high",
      tags: ["frontend", "ui"]
    });

    expect(task.folder).toBe("custom-folder");
    expect(task.frontmatter.title).toBe("Custom Task");
    expect(task.frontmatter.status).toBe("INPROGRESS");
    expect(task.frontmatter.priority).toBe("high");
    expect(task.frontmatter.tags).toEqual(["frontend", "ui"]);
  });
});

describe("createMockSubtask", () => {
  it("creates a subtask with default values", () => {
    const subtask = createMockSubtask();

    expect(subtask.number).toBe(1);
    expect(subtask.slug).toBe("subtask-1");
    expect(subtask.filename).toBe("001-subtask-1.md");
    expect(subtask.frontmatter.status).toBe("PENDING");
    expect(subtask.frontmatter.dependencies).toEqual([]);
  });

  it("allows overriding subtask properties", () => {
    const subtask = createMockSubtask({
      number: 3,
      title: "Custom Subtask",
      status: "INPROGRESS",
      dependencies: [1, 2]
    });

    expect(subtask.number).toBe(3);
    expect(subtask.frontmatter.title).toBe("Custom Subtask");
    expect(subtask.frontmatter.status).toBe("INPROGRESS");
    expect(subtask.frontmatter.dependencies).toEqual([1, 2]);
  });
});

describe("createMockPlan", () => {
  it("creates a plan with default subtask count", () => {
    const plan = createMockPlan("my-task");

    expect(plan.folder).toBe("my-task");
    expect(plan.frontmatter.task).toBe("my-task");
    expect(plan.frontmatter.status).toBe("INPROGRESS");
    expect(plan.subtasks).toHaveLength(3);
  });

  it("creates a plan with specified subtask count", () => {
    const plan = createMockPlan("my-task", 5);

    expect(plan.subtasks).toHaveLength(5);
    expect(plan.subtasks[0]?.dependencies).toEqual([]);
    expect(plan.subtasks[1]?.dependencies).toEqual([1]);
    expect(plan.subtasks[4]?.dependencies).toEqual([4]);
  });

  it("generates sequential subtask references", () => {
    const plan = createMockPlan("task", 3);

    expect(plan.subtasks[0]).toEqual({
      number: 1,
      slug: "subtask-1",
      title: "Subtask 1",
      dependencies: []
    });
    expect(plan.subtasks[2]).toEqual({
      number: 3,
      slug: "subtask-3",
      title: "Subtask 3",
      dependencies: [2]
    });
  });
});

describe("createMockOrchestratorState", () => {
  it("creates state with default task and subtask counts", () => {
    const state = createMockOrchestratorState();

    expect(state.tasks).toHaveLength(2);
    expect(Object.keys(state.plans)).toHaveLength(2);
    expect(Object.keys(state.subtasks)).toHaveLength(2);
  });

  it("creates state with custom task count", () => {
    const state = createMockOrchestratorState({ taskCount: 4 });

    expect(state.tasks).toHaveLength(4);
    expect(Object.keys(state.plans)).toHaveLength(4);
  });

  it("creates state with custom subtasks per task", () => {
    const state = createMockOrchestratorState({ subtasksPerTask: 5 });

    for (const task of state.tasks) {
      expect(state.subtasks[task.folder]).toHaveLength(5);
    }
  });

  it("sets first task to INPROGRESS and high priority", () => {
    const state = createMockOrchestratorState();

    expect(state.tasks[0]?.frontmatter.status).toBe("INPROGRESS");
    expect(state.tasks[0]?.frontmatter.priority).toBe("high");
    expect(state.tasks[1]?.frontmatter.status).toBe("PENDING");
  });

  it("sets first subtask of each task to INPROGRESS", () => {
    const state = createMockOrchestratorState();

    for (const taskSubtasks of Object.values(state.subtasks)) {
      expect(taskSubtasks[0]?.frontmatter.status).toBe("INPROGRESS");
      expect(taskSubtasks[1]?.frontmatter.status).toBe("PENDING");
    }
  });

  it("allows providing custom tasks", () => {
    const customTasks = [
      createMockTask({ folder: "custom-1", title: "Custom 1" }),
      createMockTask({ folder: "custom-2", title: "Custom 2" })
    ];

    const state = createMockOrchestratorState({ tasks: customTasks });

    expect(state.tasks).toEqual(customTasks);
    expect(state.plans["custom-1"]).toBeDefined();
    expect(state.plans["custom-2"]).toBeDefined();
  });

  it("links plans and subtasks to task folders", () => {
    const state = createMockOrchestratorState({ taskCount: 1 });
    const taskFolder = state.tasks[0]!.folder;

    expect(state.plans[taskFolder]).toBeDefined();
    expect(state.plans[taskFolder]?.folder).toBe(taskFolder);
    expect(state.subtasks[taskFolder]).toBeDefined();
  });
});
