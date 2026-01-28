import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { Subtask, Task } from "../types";
import { TaskCard } from "./TaskCard";

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  folder: "test-task",
  frontmatter: {
    title: "Test Task",
    status: "PENDING",
    created: new Date("2026-01-27"),
    priority: "medium",
    tags: [],
    assignee: null,
    dependencies: []
  },
  description: "Test description",
  requirements: "Test requirements",
  acceptanceCriteria: [],
  ...overrides
});

const createMockSubtasks = (total: number, done: number): Subtask[] => {
  return Array.from({ length: total }, (_, i) => ({
    filename: `00${i + 1}-subtask.md`,
    number: i + 1,
    slug: `subtask-${i + 1}`,
    frontmatter: {
      title: `Subtask ${i + 1}`,
      status: i < done ? "DONE" : "PENDING",
      dependencies: []
    },
    description: `Subtask ${i + 1} description`
  }));
};

describe("TaskCard", () => {
  test("renders task title", () => {
    const task = createMockTask();
    const html = renderToString(
      <TaskCard task={task} subtasks={[]} onClick={() => {}} />
    );
    expect(html).toContain("Test Task");
  });

  test("renders status badge", () => {
    const task = createMockTask({
      frontmatter: { ...createMockTask().frontmatter, status: "INPROGRESS" }
    });
    const html = renderToString(
      <TaskCard task={task} subtasks={[]} onClick={() => {}} />
    );
    expect(html).toContain("INPROGRESS");
    expect(html).toContain("status-badge");
  });

  test("renders progress bar with correct percentage", () => {
    const task = createMockTask();
    const subtasks = createMockSubtasks(4, 2);
    const html = renderToString(
      <TaskCard task={task} subtasks={subtasks} onClick={() => {}} />
    );
    expect(html).toContain("progress-bar");
    expect(html).toContain("50%");
  });

  test("shows 0% when no subtasks", () => {
    const task = createMockTask();
    const html = renderToString(
      <TaskCard task={task} subtasks={[]} onClick={() => {}} />
    );
    expect(html).toContain("0%");
  });

  test("shows 100% when all subtasks done", () => {
    const task = createMockTask();
    const subtasks = createMockSubtasks(3, 3);
    const html = renderToString(
      <TaskCard task={task} subtasks={subtasks} onClick={() => {}} />
    );
    expect(html).toContain("100%");
  });

  test("applies selected class when selected", () => {
    const task = createMockTask();
    const html = renderToString(
      <TaskCard task={task} subtasks={[]} onClick={() => {}} selected />
    );
    expect(html).toContain("selected");
  });

  test("does not apply selected class when not selected", () => {
    const task = createMockTask();
    const html = renderToString(
      <TaskCard task={task} subtasks={[]} onClick={() => {}} />
    );
    expect(html).not.toContain("selected");
  });

  test("shows active agent indicator when hasActiveAgent is true", () => {
    const task = createMockTask();
    const html = renderToString(
      <TaskCard task={task} subtasks={[]} onClick={() => {}} hasActiveAgent />
    );
    expect(html).toContain("agent-indicator");
  });

  test("does not show agent indicator when hasActiveAgent is false", () => {
    const task = createMockTask();
    const html = renderToString(
      <TaskCard task={task} subtasks={[]} onClick={() => {}} />
    );
    expect(html).not.toContain("agent-indicator");
  });

  test("renders subtask count", () => {
    const task = createMockTask();
    const subtasks = createMockSubtasks(5, 2);
    const html = renderToString(
      <TaskCard task={task} subtasks={subtasks} onClick={() => {}} />
    );
    expect(html).toContain("task-card-count");
    expect(html).toMatch(/2.*5/);
  });

  test("renders status toggle for BACKLOG task", () => {
    const task = createMockTask({
      frontmatter: { ...createMockTask().frontmatter, status: "BACKLOG" }
    });
    const html = renderToString(
      <TaskCard
        task={task}
        subtasks={[]}
        onClick={() => {}}
        onStatusChange={() => {}}
      />
    );
    expect(html).toContain("status-toggle");
    expect(html).toContain("Start");
  });

  test("renders status toggle for PENDING task with Defer label", () => {
    const task = createMockTask({
      frontmatter: { ...createMockTask().frontmatter, status: "PENDING" }
    });
    const html = renderToString(
      <TaskCard
        task={task}
        subtasks={[]}
        onClick={() => {}}
        onStatusChange={() => {}}
      />
    );
    expect(html).toContain("status-toggle");
    expect(html).toContain("Defer");
  });

  test("renders status toggle for BLOCKED task with Unblock label", () => {
    const task = createMockTask({
      frontmatter: { ...createMockTask().frontmatter, status: "BLOCKED" }
    });
    const html = renderToString(
      <TaskCard
        task={task}
        subtasks={[]}
        onClick={() => {}}
        onStatusChange={() => {}}
      />
    );
    expect(html).toContain("status-toggle");
    expect(html).toContain("Unblock");
  });

  test("does not render status toggle when onStatusChange is not provided", () => {
    const task = createMockTask({
      frontmatter: { ...createMockTask().frontmatter, status: "BACKLOG" }
    });
    const html = renderToString(
      <TaskCard task={task} subtasks={[]} onClick={() => {}} />
    );
    expect(html).not.toContain("status-toggle");
  });

  test("does not render status toggle for INPROGRESS task", () => {
    const task = createMockTask({
      frontmatter: { ...createMockTask().frontmatter, status: "INPROGRESS" }
    });
    const html = renderToString(
      <TaskCard
        task={task}
        subtasks={[]}
        onClick={() => {}}
        onStatusChange={() => {}}
      />
    );
    expect(html).not.toContain("status-toggle");
  });
});
