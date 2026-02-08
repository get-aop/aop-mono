import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { Task } from "../types";
import { TaskCard } from "./TaskCard";

if (!globalThis.document || !("defaultView" in globalThis.document)) {
  const win = new Window({ url: "http://localhost" });
  for (const key of Object.getOwnPropertyNames(win)) {
    if (!(key in globalThis)) {
      Object.defineProperty(globalThis, key, {
        value: (win as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      });
    }
  }
  globalThis.document = win.document as unknown as Document;
}

const { render, screen, cleanup, act } = await import("@testing-library/react");

afterEach(cleanup);

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  repoId: "repo-1",
  repoPath: "/home/user/my-repo",
  changePath: "changes/feat-1",
  status: "DRAFT",
  baseBranch: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("TaskCard duration display", () => {
  test("DRAFT task shows no duration", () => {
    render(<TaskCard task={makeTask({ status: "DRAFT" })} />);
    expect(screen.queryByTestId("task-duration")).toBeNull();
  });

  test("READY task shows no duration", () => {
    render(<TaskCard task={makeTask({ status: "READY" })} />);
    expect(screen.queryByTestId("task-duration")).toBeNull();
  });

  test("WORKING task without executionStartedAt shows no duration", () => {
    render(<TaskCard task={makeTask({ status: "WORKING" })} />);
    expect(screen.queryByTestId("task-duration")).toBeNull();
  });

  test("WORKING task with executionStartedAt shows duration with ellipsis", () => {
    render(
      <TaskCard
        task={makeTask({
          status: "WORKING",
          executionStartedAt: "2024-01-01T00:00:00.000Z",
        })}
      />,
    );
    const el = screen.getByTestId("task-duration");
    expect(el.textContent).toContain("...");
  });

  test("DONE task with timing shows static duration", () => {
    render(
      <TaskCard
        task={makeTask({
          status: "DONE",
          executionStartedAt: "2024-01-01T00:00:00.000Z",
          executionCompletedAt: "2024-01-01T00:05:23.000Z",
        })}
      />,
    );
    const el = screen.getByTestId("task-duration");
    expect(el.textContent).toContain("5m 23s");
    expect(el.textContent).not.toContain("...");
  });

  test("DONE task without executionStartedAt shows no duration", () => {
    render(<TaskCard task={makeTask({ status: "DONE" })} />);
    expect(screen.queryByTestId("task-duration")).toBeNull();
  });

  test("BLOCKED task with timing shows no duration", () => {
    render(
      <TaskCard
        task={makeTask({
          status: "BLOCKED",
          executionStartedAt: "2024-01-01T00:00:00.000Z",
          executionCompletedAt: "2024-01-01T00:02:00.000Z",
        })}
      />,
    );
    expect(screen.queryByTestId("task-duration")).toBeNull();
  });

  test("REMOVED task shows no duration", () => {
    render(<TaskCard task={makeTask({ status: "REMOVED" })} />);
    expect(screen.queryByTestId("task-duration")).toBeNull();
  });

  test("WORKING task live-ticks the duration", () => {
    const originalSetInterval = globalThis.setInterval;
    const callbacks: Array<() => void> = [];
    globalThis.setInterval = ((cb: () => void) => {
      callbacks.push(cb);
      return 1;
    }) as typeof setInterval;

    render(
      <TaskCard
        task={makeTask({
          status: "WORKING",
          executionStartedAt: "2024-01-01T00:00:00.000Z",
        })}
      />,
    );

    expect(callbacks.length).toBeGreaterThan(0);

    act(() => {
      for (const cb of callbacks) cb();
    });

    expect(screen.getByTestId("task-duration").textContent).toContain("...");
    globalThis.setInterval = originalSetInterval;
  });
});

describe("TaskCard progress display", () => {
  test("shows progress when taskProgress exists", () => {
    render(<TaskCard task={makeTask({ taskProgress: { completed: 3, total: 17 } })} />);
    const el = screen.getByTestId("task-progress");
    expect(el.textContent).toContain("3/17");
  });

  test("hides progress when taskProgress is absent", () => {
    render(<TaskCard task={makeTask()} />);
    expect(screen.queryByTestId("task-progress")).toBeNull();
  });
});
