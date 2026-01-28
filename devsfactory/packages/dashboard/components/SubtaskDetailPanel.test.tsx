import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { StoreContext } from "../context";
import { createDashboardStore } from "../store";
import type { Subtask, SubtaskStatus } from "../types";
import {
  ConnectedSubtaskDetailPanel,
  SubtaskDetailPanel,
  type SubtaskDetailPanelProps
} from "./SubtaskDetailPanel";

const createMockSubtask = (overrides: Partial<Subtask> = {}): Subtask => ({
  filename: "001-implement-feature.md",
  number: 1,
  slug: "implement-feature",
  frontmatter: {
    title: "Implement Feature",
    status: "INPROGRESS",
    dependencies: []
  },
  description: "Implement the new feature with TDD approach",
  context: "This is the context section",
  result: undefined,
  review: undefined,
  blockers: undefined,
  ...overrides
});

const defaultProps: SubtaskDetailPanelProps = {
  taskFolder: "my-task",
  subtaskFile: "001-implement-feature.md",
  subtask: createMockSubtask(),
  logs: [],
  isLoading: false,
  debugMode: false,
  hasActiveAgent: false,
  onClose: () => {}
};

const renderPanel = (overrides: Partial<SubtaskDetailPanelProps> = {}) =>
  renderToString(<SubtaskDetailPanel {...defaultProps} {...overrides} />);

describe("SubtaskDetailPanel", () => {
  describe("container and layout", () => {
    test("renders panel container", () => {
      const html = renderPanel();
      expect(html).toContain("subtask-detail-panel");
    });

    test("renders header section", () => {
      const html = renderPanel();
      expect(html).toContain("subtask-detail-header");
    });

    test("renders metadata section", () => {
      const html = renderPanel();
      expect(html).toContain("subtask-metadata");
    });

    test("renders logs section", () => {
      const html = renderPanel();
      expect(html).toContain("subtask-logs");
    });
  });

  describe("header", () => {
    test("renders back button", () => {
      const html = renderPanel();
      expect(html).toContain("back-button");
    });

    test("renders subtask number in header", () => {
      const html = renderPanel({ subtask: createMockSubtask({ number: 3 }) });
      expect(html).toMatch(/Subtask #.*3/);
    });

    test("renders 'Subtask Details' text", () => {
      const html = renderPanel();
      expect(html).toContain("Subtask");
    });
  });

  describe("metadata display", () => {
    test("renders subtask title", () => {
      const html = renderPanel();
      expect(html).toContain("Implement Feature");
    });

    test("renders subtask status badge", () => {
      const html = renderPanel();
      expect(html).toContain("status-badge");
      expect(html).toContain("INPROGRESS");
    });

    test("renders different status values", () => {
      const statuses: SubtaskStatus[] = [
        "PENDING",
        "INPROGRESS",
        "AGENT_REVIEW",
        "DONE",
        "BLOCKED"
      ];
      for (const status of statuses) {
        const html = renderPanel({
          subtask: createMockSubtask({
            frontmatter: { title: "Test", status, dependencies: [] }
          })
        });
        expect(html).toContain(status);
      }
    });

    test("renders dependencies when present", () => {
      const html = renderPanel({
        subtask: createMockSubtask({
          frontmatter: { title: "Test", status: "PENDING", dependencies: [1, 2] }
        })
      });
      expect(html).toContain("1");
      expect(html).toContain("2");
    });

    test("shows no dependencies indicator when empty", () => {
      const html = renderPanel({
        subtask: createMockSubtask({
          frontmatter: { title: "Test", status: "PENDING", dependencies: [] }
        })
      });
      expect(html).toContain("None");
    });

    test("renders description", () => {
      const html = renderPanel();
      expect(html).toContain("Implement the new feature with TDD approach");
    });
  });

  describe("logs section", () => {
    test("renders logs header", () => {
      const html = renderPanel();
      expect(html).toContain("Logs");
    });

    test("shows loading state when fetching logs", () => {
      const html = renderPanel({ isLoading: true });
      expect(html).toContain("Loading");
    });

    test("shows empty state when no logs", () => {
      const html = renderPanel({ logs: [] });
      expect(html).toContain("No logs");
    });

    test("renders log lines", () => {
      const html = renderPanel({
        logs: ["Starting implementation...", "Reading files..."]
      });
      expect(html).toContain("Starting implementation...");
      expect(html).toContain("Reading files...");
    });

    test("uses DebugStream for log display", () => {
      const html = renderPanel({
        logs: ["test log"],
        debugMode: true
      });
      expect(html).toContain("debug-stream");
    });
  });

  describe("active agent indicator", () => {
    test("shows active indicator when agent is working", () => {
      const html = renderPanel({ hasActiveAgent: true });
      expect(html).toContain("active");
    });

    test("hides active indicator when no agent working", () => {
      const html = renderPanel({ hasActiveAgent: false });
      expect(html).not.toContain("agent-active");
    });
  });
});

describe("ConnectedSubtaskDetailPanel", () => {
  const mockApiClient = {
    baseUrl: "http://localhost:3000",
    fetchState: async () => ({ tasks: [], plans: {}, subtasks: {} }),
    updateTaskStatus: async () => {},
    updateSubtaskStatus: async () => {},
    createPullRequest: async () => ({
      prUrl: "https://github.com/org/repo/pull/1"
    }),
    fetchDiff: async () => ({ diff: "+line" }),
    getSubtaskLogs: async () => ({ logs: [] })
  };

  const renderConnected = (storeOverrides: {
    selectedSubtask?: { taskFolder: string; subtaskFile: string } | null;
    subtaskLogs?: string[];
    subtaskLogsLoading?: boolean;
    debugMode?: boolean;
    subtasks?: Record<string, Subtask[]>;
    activeAgents?: Map<string, { taskFolder: string; subtaskFile?: string; type: string }>;
  } = {}) => {
    const store = createDashboardStore(mockApiClient, {
      selectedSubtask: storeOverrides.selectedSubtask ?? null,
      subtaskLogs: storeOverrides.subtaskLogs ?? [],
      subtaskLogsLoading: storeOverrides.subtaskLogsLoading ?? false,
      debugMode: storeOverrides.debugMode ?? false,
      subtasks: storeOverrides.subtasks ?? {},
      activeAgents: storeOverrides.activeAgents ?? new Map()
    });
    return renderToString(
      <StoreContext.Provider value={store}>
        <ConnectedSubtaskDetailPanel />
      </StoreContext.Provider>
    );
  };

  test("returns null when no subtask selected", () => {
    const html = renderConnected({ selectedSubtask: null });
    expect(html).toBe("");
  });

  test("returns null when selected subtask not found", () => {
    const html = renderConnected({
      selectedSubtask: { taskFolder: "task-1", subtaskFile: "001-missing.md" },
      subtasks: {}
    });
    expect(html).toBe("");
  });

  test("renders panel when subtask is selected and found", () => {
    const html = renderConnected({
      selectedSubtask: { taskFolder: "task-1", subtaskFile: "001-test.md" },
      subtasks: {
        "task-1": [createMockSubtask({ filename: "001-test.md" })]
      }
    });
    expect(html).toContain("subtask-detail-panel");
    expect(html).toContain("Implement Feature");
  });

  test("passes logs from store", () => {
    const html = renderConnected({
      selectedSubtask: { taskFolder: "task-1", subtaskFile: "001-test.md" },
      subtasks: {
        "task-1": [createMockSubtask({ filename: "001-test.md" })]
      },
      subtaskLogs: ["Log line 1", "Log line 2"]
    });
    expect(html).toContain("Log line 1");
    expect(html).toContain("Log line 2");
  });

  test("passes loading state from store", () => {
    const html = renderConnected({
      selectedSubtask: { taskFolder: "task-1", subtaskFile: "001-test.md" },
      subtasks: {
        "task-1": [createMockSubtask({ filename: "001-test.md" })]
      },
      subtaskLogsLoading: true
    });
    expect(html).toContain("Loading");
  });

  test("detects active agent for subtask", () => {
    const activeAgents = new Map<string, { taskFolder: string; subtaskFile?: string; type: string }>();
    activeAgents.set("agent-1", {
      taskFolder: "task-1",
      subtaskFile: "001-test.md",
      type: "implementation"
    });

    const html = renderConnected({
      selectedSubtask: { taskFolder: "task-1", subtaskFile: "001-test.md" },
      subtasks: {
        "task-1": [createMockSubtask({ filename: "001-test.md" })]
      },
      activeAgents
    });
    expect(html).toContain("active");
  });
});
