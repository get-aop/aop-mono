import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import type { Task } from "../types";
import { PausedBanner } from "./PausedBanner";

setupDashboardDom();

const { render, screen, cleanup, fireEvent } = await import("@testing-library/react");

afterEach(cleanup);

const makePausedTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  repoId: "repo-1",
  repoPath: "/home/user/repos/my-repo",
  status: "PAUSED",
  changePath: "docs/tasks/my-feature",
  baseBranch: null,
  preferredProvider: null,
  preferredWorkflow: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("PausedBanner", () => {
  test("renders nothing when there are no paused tasks", () => {
    const { container } = render(<PausedBanner tasks={[]} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders banner with paused tasks", () => {
    const tasks = [makePausedTask()];
    render(<PausedBanner tasks={tasks} />);

    expect(screen.getByTestId("paused-banner")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  test("displays change name and repo name for each task", () => {
    const tasks = [makePausedTask()];
    render(<PausedBanner tasks={tasks} />);

    expect(screen.getByText("my-feature")).toBeDefined();
    expect(screen.getByText("my-repo")).toBeDefined();
  });

  test("calls onTaskClick when task card is clicked", () => {
    const task = makePausedTask();
    const onClick = mock(() => {});
    render(<PausedBanner tasks={[task]} onTaskClick={onClick} />);

    fireEvent.click(screen.getByTestId("paused-task-task-1"));
    expect(onClick).toHaveBeenCalledWith(task);
  });

  test("calls onResume when Resume button is clicked", () => {
    const task = makePausedTask();
    const onResume = mock(() => {});
    render(<PausedBanner tasks={[task]} onResume={onResume} />);

    fireEvent.click(screen.getByTestId("resume-button-task-1"));
    expect(onResume).toHaveBeenCalledWith(task);
  });

  test("uses amber styling", () => {
    const tasks = [makePausedTask()];
    render(<PausedBanner tasks={tasks} />);

    const banner = screen.getByTestId("paused-banner");
    expect(banner.className).toContain("aop-amber");
  });
});
