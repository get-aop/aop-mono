import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { StoreContext } from "../context";
import {
  createDashboardStore,
  type DashboardStoreInitialState
} from "../store";
import type { Subtask, Task } from "../types";
import { TaskList } from "./TaskList";

const createMockTask = (
  folder: string,
  title: string,
  status = "PENDING" as const
): Task => ({
  folder,
  frontmatter: {
    title,
    status,
    created: new Date("2026-01-27"),
    priority: "medium",
    tags: [],
    assignee: null,
    dependencies: []
  },
  description: "Test description",
  requirements: "Test requirements",
  acceptanceCriteria: []
});

const createMockSubtasks = (total: number, done: number): Subtask[] =>
  Array.from({ length: total }, (_, i) => ({
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

const renderWithStore = (
  component: React.ReactNode,
  initialState?: DashboardStoreInitialState
) => {
  const store = createDashboardStore(undefined, initialState);
  return renderToString(
    <StoreContext.Provider value={store}>{component}</StoreContext.Provider>
  );
};

describe("TaskList", () => {
  test("renders task-list container", () => {
    const html = renderWithStore(<TaskList />);
    expect(html).toContain("task-list");
  });

  test("displays all tasks from store", () => {
    const tasks = [
      createMockTask("task-1", "First Task"),
      createMockTask("task-2", "Second Task"),
      createMockTask("task-3", "Third Task")
    ];
    const html = renderWithStore(<TaskList />, { tasks });
    expect(html).toContain("First Task");
    expect(html).toContain("Second Task");
    expect(html).toContain("Third Task");
  });

  test("shows empty state when no tasks", () => {
    const html = renderWithStore(<TaskList />, { tasks: [] });
    expect(html).toContain("No tasks");
  });

  test("marks selected task with selected class", () => {
    const tasks = [
      createMockTask("task-1", "First Task"),
      createMockTask("task-2", "Second Task")
    ];
    const html = renderWithStore(<TaskList />, {
      tasks,
      selectedTask: "task-1"
    });
    expect(html).toContain("selected");
  });

  test("shows active agent indicator for tasks with running agents", () => {
    const tasks = [createMockTask("task-1", "Task With Agent", "INPROGRESS")];
    const activeAgents = new Map([
      ["agent-1", { taskFolder: "task-1", type: "implementation" as const }]
    ]);
    const html = renderWithStore(<TaskList />, { tasks, activeAgents });
    expect(html).toContain("agent-indicator");
  });

  test("displays correct subtask progress for each task", () => {
    const tasks = [createMockTask("task-1", "Task One")];
    const subtasks = { "task-1": createMockSubtasks(4, 2) };
    const html = renderWithStore(<TaskList />, { tasks, subtasks });
    expect(html).toContain("50%");
  });

  test("renders TaskCard for each task", () => {
    const tasks = [
      createMockTask("task-1", "First Task"),
      createMockTask("task-2", "Second Task")
    ];
    const html = renderWithStore(<TaskList />, { tasks });
    expect(html).toContain("task-card");
  });

  test("renders status toggle for BACKLOG tasks", () => {
    const tasks = [createMockTask("task-1", "Backlog Task", "BACKLOG")];
    const html = renderWithStore(<TaskList />, { tasks });
    expect(html).toContain("status-toggle");
    expect(html).toContain("Start");
  });

  test("renders status toggle for BLOCKED tasks", () => {
    const tasks = [createMockTask("task-1", "Blocked Task", "BLOCKED")];
    const html = renderWithStore(<TaskList />, { tasks });
    expect(html).toContain("status-toggle");
    expect(html).toContain("Unblock");
  });
});
