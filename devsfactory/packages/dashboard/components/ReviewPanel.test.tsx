import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { StoreContext } from "../context";
import { createDashboardStore } from "../store";
import type { Task } from "../types";
import {
  ConnectedReviewPanel,
  ReviewPanel,
  type ReviewPanelProps
} from "./ReviewPanel";

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  folder: "add-authentication",
  frontmatter: {
    title: "Add Authentication",
    status: "REVIEW",
    created: new Date("2026-01-27"),
    priority: "high",
    tags: ["auth"],
    assignee: null,
    dependencies: []
  },
  description: "Add user authentication",
  requirements: "Users must be able to log in",
  acceptanceCriteria: [
    { text: "User can log in with email/password", checked: false },
    { text: "Session persists across page refresh", checked: false },
    { text: "Invalid credentials show error message", checked: false }
  ],
  ...overrides
});

const defaultProps: ReviewPanelProps = {
  task: createMockTask(),
  diff: null,
  diffLoading: false,
  diffError: null,
  prUrl: null,
  prLoading: false,
  onCreatePr: async () => {}
};

const renderReviewPanel = (overrides: Partial<ReviewPanelProps> = {}) => {
  return renderToString(<ReviewPanel {...defaultProps} {...overrides} />);
};

describe("ReviewPanel", () => {
  test("renders review panel container", () => {
    const html = renderReviewPanel();
    expect(html).toContain("review-panel");
  });

  test("renders task title in header", () => {
    const html = renderReviewPanel();
    expect(html).toContain("add-authentication");
  });

  test("renders Review label in header", () => {
    const html = renderReviewPanel();
    expect(html).toContain("Review:");
  });

  test("renders Create PR button", () => {
    const html = renderReviewPanel();
    expect(html).toContain("Create PR");
  });

  test("renders acceptance criteria section", () => {
    const html = renderReviewPanel();
    expect(html).toContain("Acceptance Criteria");
  });

  test("renders checklist from task acceptance criteria", () => {
    const html = renderReviewPanel();
    expect(html).toContain("User can log in with email/password");
    expect(html).toContain("Session persists across page refresh");
    expect(html).toContain("Invalid credentials show error message");
  });

  test("renders diff viewer section", () => {
    const html = renderReviewPanel();
    expect(html).toContain("diff-viewer");
  });

  test("shows changes header with branch info", () => {
    const html = renderReviewPanel();
    expect(html).toContain("Changes");
  });

  test("shows PR URL after creation", () => {
    const html = renderReviewPanel({
      prUrl: "https://github.com/org/repo/pull/123"
    });
    expect(html).toContain("https://github.com/org/repo/pull/123");
  });

  test("makes PR URL clickable", () => {
    const html = renderReviewPanel({
      prUrl: "https://github.com/org/repo/pull/123"
    });
    expect(html).toContain('href="https://github.com/org/repo/pull/123"');
    expect(html).toContain('target="_blank"');
  });

  test("shows loading state when creating PR", () => {
    const html = renderReviewPanel({ prLoading: true });
    expect(html).toContain("Creating PR");
  });

  test("renders diff stats when diff is available", () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1 +1,3 @@
+line 1
+line 2
 unchanged`;
    const html = renderReviewPanel({ diff });
    expect(html).toContain("diff-stats");
  });

  test("shows diff loading state", () => {
    const html = renderReviewPanel({ diffLoading: true });
    expect(html).toContain("Loading diff");
  });

  test("shows diff error state", () => {
    const html = renderReviewPanel({ diffError: "Failed to load diff" });
    expect(html).toContain("Failed to load diff");
  });

  test("renders checkboxes as toggleable", () => {
    const html = renderReviewPanel();
    expect(html).toContain('type="checkbox"');
  });
});

describe("ConnectedReviewPanel", () => {
  const mockApiClient = {
    baseUrl: "http://localhost:3000",
    fetchState: async () => ({ tasks: [], plans: {}, subtasks: {} }),
    updateTaskStatus: async () => {},
    updateSubtaskStatus: async () => {},
    createPullRequest: async () => ({
      prUrl: "https://github.com/org/repo/pull/1"
    }),
    fetchDiff: async () => ({ diff: "+line" })
  };

  const renderConnected = (task: Task) => {
    const store = createDashboardStore(mockApiClient);
    return renderToString(
      <StoreContext.Provider value={store}>
        <ConnectedReviewPanel task={task} />
      </StoreContext.Provider>
    );
  };

  test("renders connected review panel with task", () => {
    const html = renderConnected(createMockTask());
    expect(html).toContain("review-panel");
    expect(html).toContain("add-authentication");
  });

  test("shows loading state initially", () => {
    const html = renderConnected(createMockTask());
    expect(html).toContain("Loading diff");
  });

  test("renders acceptance criteria from task", () => {
    const html = renderConnected(createMockTask());
    expect(html).toContain("User can log in with email/password");
  });
});
