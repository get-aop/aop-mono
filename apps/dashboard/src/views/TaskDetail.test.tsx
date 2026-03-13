import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const mockUseTaskEvents = mock(() => ({
  tasks: [
    {
      id: "task-1",
      repoId: "repo-1",
      repoPath: "/tmp/repo",
      changePath: "docs/tasks/test-task",
      status: "DONE" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T01:00:00Z",
      currentExecutionId: null,
      baseBranch: null,
      preferredProvider: null,
      errorMessage: null,
      executionStartedAt: null,
      executionCompletedAt: null,
      taskProgress: null,
    },
  ],
  capacity: { working: 0, max: 3 },
  repos: [],
  connected: true,
  initialized: true,
  refresh: mock(),
}));

mock.module("../hooks/useTaskEvents", () => ({
  useTaskEvents: mockUseTaskEvents,
}));

mock.module("../hooks/useSSE", () => ({
  useSSE: () => ({ connected: false }),
}));

const { TaskDetail } = await import("./TaskDetail");

const originalFetch = globalThis.fetch;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ executions: [] }), { status: 200 })),
  ) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

const renderDetail = (taskId = "task-1") => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root.render(<TaskDetail taskId={taskId} onClose={() => {}} />));
};

describe("TaskDetail scroll layout", () => {
  test("main content area allows overflow scrolling", () => {
    renderDetail();
    const detail = container.querySelector("[data-testid='task-detail']") as HTMLElement;
    const main = detail.querySelector("main") as HTMLElement;

    expect(main).toBeTruthy();
    expect(main.className).toContain("overflow-auto");
    expect(main.className).not.toContain("overflow-hidden");
  });

  test("detail view uses h-screen with flex column layout", () => {
    renderDetail();
    const detail = container.querySelector("[data-testid='task-detail']") as HTMLElement;

    expect(detail.className).toContain("h-screen");
    expect(detail.className).toContain("flex");
    expect(detail.className).toContain("flex-col");
  });

  test("main content area uses flex-1 to fill remaining space", () => {
    renderDetail();
    const detail = container.querySelector("[data-testid='task-detail']") as HTMLElement;
    const main = detail.querySelector("main") as HTMLElement;

    expect(main.className).toContain("flex-1");
  });
});
