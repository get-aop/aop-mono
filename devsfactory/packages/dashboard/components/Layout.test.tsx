import { describe, test, expect } from "bun:test";
import { renderToString } from "react-dom/server";
import { StoreContext } from "../context";
import { createDashboardStore } from "../store";
import type { Subtask } from "../types";
import { Layout } from "./Layout";

const mockSubtask: Subtask = {
  filename: "001-test-subtask.md",
  number: 1,
  slug: "test-subtask",
  frontmatter: {
    title: "Test Subtask",
    status: "PENDING",
    dependencies: []
  },
  description: "A test subtask"
};

describe("Layout Panel Switching", () => {
  test("shows ActivityFeed when no subtask is selected", () => {
    const store = createDashboardStore(undefined, {
      tasks: [
        {
          folder: "test-task",
          frontmatter: {
            title: "Test Task",
            status: "INPROGRESS",
            created: new Date(),
            priority: "medium",
            tags: [],
            assignee: null,
            dependencies: []
          },
          description: "",
          requirements: "",
          acceptanceCriteria: []
        }
      ],
      selectedTask: "test-task",
      plans: {
        "test-task": {
          folder: "test-task",
          frontmatter: {
            status: "INPROGRESS",
            task: "test-task",
            created: new Date()
          },
          subtasks: [
            {
              number: 1,
              slug: "test-subtask",
              title: "Test Subtask",
              dependencies: []
            }
          ]
        }
      },
      subtasks: {
        "test-task": [mockSubtask]
      },
      selectedSubtask: null
    });

    const html = renderToString(
      <StoreContext.Provider value={store}>
        <Layout />
      </StoreContext.Provider>
    );

    expect(html).toContain("Activity Feed");
    expect(html).not.toContain("subtask-detail-panel");
  });

  test("shows SubtaskDetailPanel when subtask is selected", () => {
    const store = createDashboardStore(undefined, {
      tasks: [
        {
          folder: "test-task",
          frontmatter: {
            title: "Test Task",
            status: "INPROGRESS",
            created: new Date(),
            priority: "medium",
            tags: [],
            assignee: null,
            dependencies: []
          },
          description: "",
          requirements: "",
          acceptanceCriteria: []
        }
      ],
      selectedTask: "test-task",
      plans: {
        "test-task": {
          folder: "test-task",
          frontmatter: {
            status: "INPROGRESS",
            task: "test-task",
            created: new Date()
          },
          subtasks: [
            {
              number: 1,
              slug: "test-subtask",
              title: "Test Subtask",
              dependencies: []
            }
          ]
        }
      },
      subtasks: {
        "test-task": [mockSubtask]
      },
      selectedSubtask: {
        taskFolder: "test-task",
        subtaskFile: "001-test-subtask.md"
      },
      subtaskLogs: [],
      subtaskLogsLoading: false
    });

    const html = renderToString(
      <StoreContext.Provider value={store}>
        <Layout />
      </StoreContext.Provider>
    );

    expect(html).toContain("subtask-detail-panel");
    expect(html).toContain("Subtask #");
    expect(html).toContain("Details");
    expect(html).not.toContain("activity-feed");
  });
});
