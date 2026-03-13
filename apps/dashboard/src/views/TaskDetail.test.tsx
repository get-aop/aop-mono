import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const renderToString = async (component: ReactElement): Promise<string> => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(component);
};

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

beforeEach(() => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({ executions: [] }), { status: 200 })),
  ) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const renderDetail = (taskId = "task-1") => {
  return renderToString(<TaskDetail taskId={taskId} onClose={() => {}} />);
};

describe("TaskDetail scroll layout", () => {
  test("main content area allows overflow scrolling", async () => {
    const html = await renderDetail();

    expect(html).toContain('data-testid="task-detail"');
    expect(html).toContain("flex flex-1 flex-col overflow-auto px-6 py-3");
  });

  test("detail view uses h-screen with flex column layout", async () => {
    const html = await renderDetail();

    expect(html).toContain("flex h-screen flex-col bg-aop-black");
  });

  test("main content area uses flex-1 to fill remaining space", async () => {
    const html = await renderDetail();

    expect(html).toContain("flex flex-1 flex-col overflow-auto px-6 py-3");
  });
});
