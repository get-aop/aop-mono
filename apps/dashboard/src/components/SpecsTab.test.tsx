import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { Task } from "../types";
import { SpecsTab } from "./SpecsTab";

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

const { render, screen, cleanup, waitFor, fireEvent } = await import("@testing-library/react");

const originalFetch = globalThis.fetch;
const mockFetch = mock(() => Promise.resolve(new Response()));

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockClear();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  repoId: "repo-1",
  repoPath: "/home/user/my-repo",
  changePath: "docs/tasks/my-change",
  status: "DONE",
  baseBranch: null,
  preferredProvider: null,
  preferredWorkflow: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

const extractUrl = (input: unknown): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
};

const matchFileContent = (urlStr: string, fileContents: Record<string, string>) => {
  for (const [path, content] of Object.entries(fileContents)) {
    if (urlStr.includes(`/files/${encodeURIComponent(path)}`)) {
      return jsonResponse({ content });
    }
  }
  return null;
};

const setupMockFetch = (files: string[], fileContents: Record<string, string> = {}) => {
  mockFetch.mockImplementation((...args: unknown[]) => {
    const urlStr = extractUrl(args[0]);
    if (urlStr.endsWith("/files")) {
      return Promise.resolve(jsonResponse({ files }));
    }
    const matched = matchFileContent(urlStr, fileContents);
    if (matched) return Promise.resolve(matched);
    return Promise.resolve(jsonResponse({ error: "Not found" }, 404));
  });
};

describe("SpecsTab", () => {
  test("loads task.md as default file", async () => {
    setupMockFetch(["task.md", "plan.md"], {
      "task.md": "# Task\n\n## Description\nDone",
    });
    render(<SpecsTab task={makeTask()} />);
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());
    expect(screen.getByText("task.md")).toBeTruthy();
  });

  test("shows file tree flyout", async () => {
    setupMockFetch(["task.md"], { "task.md": "# Task" });
    render(<SpecsTab task={makeTask()} />);
    await waitFor(() => expect(screen.getByTestId("file-tree-flyout")).toBeTruthy());
  });

  test("shows loading state initially", () => {
    setupMockFetch(["task.md"], { "task.md": "content" });
    render(<SpecsTab task={makeTask()} />);
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  test("switches files on selection via flyout", async () => {
    setupMockFetch(["task.md", "plan.md"], {
      "task.md": "# Task",
      "plan.md": "# Plan",
    });
    render(<SpecsTab task={makeTask()} />);
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());

    fireEvent.click(screen.getByTestId("flyout-pill"));
    fireEvent.click(screen.getByTestId("file-plan.md"));
    await waitFor(() => expect(screen.getByText("plan.md")).toBeTruthy());
  });

  test("does not render progress bar (shown in header instead)", async () => {
    setupMockFetch(["task.md"], { "task.md": "# Task" });
    render(<SpecsTab task={makeTask({ taskProgress: { completed: 3, total: 10 } })} />);
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());
    expect(screen.queryByTestId("specs-progress-bar")).toBeNull();
  });

  test("shows error on fetch failure", async () => {
    mockFetch.mockImplementation((...args: unknown[]) => {
      const url = args[0];
      const urlStr =
        typeof url === "string" ? url : url instanceof URL ? url.href : (url as Request).url;
      if (urlStr.endsWith("/files")) {
        return Promise.resolve(jsonResponse({ files: ["task.md"] }));
      }
      return Promise.resolve(jsonResponse({ error: "Not found" }, 404));
    });
    render(<SpecsTab task={makeTask()} />);
    await waitFor(() => expect(screen.getByText("Failed to load file")).toBeTruthy());
  });
});
