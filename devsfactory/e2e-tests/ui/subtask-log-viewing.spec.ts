import type { Page } from "@playwright/test";
import type { OrchestratorState, Subtask } from "../../packages/dashboard/types";
import { createMockSubtask, createMockTask, expect, test } from "./fixtures";

const createStateWithSubtasks = (subtasks: Subtask[]): OrchestratorState => ({
  tasks: [
    createMockTask({
      folder: "test-task",
      title: "Test Task",
      status: "INPROGRESS"
    }),
    createMockTask({
      folder: "other-task",
      title: "Other Task",
      status: "PENDING"
    })
  ],
  plans: {
    "test-task": {
      folder: "test-task",
      frontmatter: {
        status: "INPROGRESS",
        task: "test-task",
        created: new Date("2026-01-01")
      },
      subtasks: subtasks.map((s) => ({
        number: s.number,
        slug: s.slug,
        title: s.frontmatter.title,
        dependencies: s.frontmatter.dependencies
      }))
    },
    "other-task": {
      folder: "other-task",
      frontmatter: {
        status: "PENDING",
        task: "other-task",
        created: new Date("2026-01-01")
      },
      subtasks: []
    }
  },
  subtasks: {
    "test-task": subtasks,
    "other-task": []
  }
});

const setupMockWebSocket = async (page: Page, state: OrchestratorState) => {
  await page.routeWebSocket("ws://localhost:3001/api/events", (ws) => {
    ws.onMessage(() => {});

    setTimeout(() => {
      ws.send(JSON.stringify({ type: "state", data: state }));
    }, 50);
  });
};

const selectTask = async (page: Page, taskSelector = ".task-card") => {
  const taskCard = page.locator(taskSelector).first();
  await expect(taskCard).toBeVisible({ timeout: 10000 });
  await taskCard.click();
};

const clickSubtaskNode = async (page: Page, nodeIndex = 0) => {
  const dagNode = page.locator(".dag-view svg g[role='button']").nth(nodeIndex);
  await expect(dagNode).toBeVisible();
  await dagNode.click();
};

test.describe("Subtask Log Viewing", () => {
  test.describe("Subtask Detail Panel Display", () => {
    test("clicking subtask node shows detail panel with metadata", async ({
      page
    }) => {
      const subtasks = [
        createMockSubtask({
          number: 1,
          title: "Setup Base Infrastructure",
          status: "INPROGRESS",
          dependencies: []
        }),
        createMockSubtask({
          number: 2,
          title: "Implement Feature",
          status: "PENDING",
          dependencies: [1]
        })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: [] })
        });
      });

      await page.goto("/");
      await selectTask(page);
      await clickSubtaskNode(page, 0);

      const detailPanel = page.locator(".subtask-detail-panel");
      await expect(detailPanel).toBeVisible({ timeout: 10000 });

      await expect(detailPanel.locator(".subtask-title-header")).toContainText(
        "Subtask #1"
      );
      await expect(detailPanel.locator(".metadata-value").first()).toContainText(
        "Subtask 1"
      );

      const statusBadge = detailPanel.locator(".status-badge");
      await expect(statusBadge).toBeVisible();
      await expect(statusBadge).toContainText("INPROGRESS");
    });

    test("detail panel shows subtask dependencies", async ({ page }) => {
      const subtasks = [
        createMockSubtask({
          number: 1,
          title: "First Task",
          status: "DONE",
          dependencies: []
        }),
        createMockSubtask({
          number: 2,
          title: "Second Task",
          status: "INPROGRESS",
          dependencies: [1]
        })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: [] })
        });
      });

      await page.goto("/");
      await selectTask(page);
      await clickSubtaskNode(page, 1);

      const detailPanel = page.locator(".subtask-detail-panel");
      await expect(detailPanel).toBeVisible({ timeout: 10000 });

      const dependenciesRow = detailPanel.locator(".metadata-row").nth(2);
      await expect(dependenciesRow).toContainText("Dependencies:");
      await expect(dependenciesRow).toContainText("1");
    });

    test("back button returns to activity feed", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: [] })
        });
      });

      await page.goto("/");
      await selectTask(page);
      await clickSubtaskNode(page);

      const detailPanel = page.locator(".subtask-detail-panel");
      await expect(detailPanel).toBeVisible({ timeout: 10000 });

      const backButton = detailPanel.locator(".back-button");
      await expect(backButton).toBeVisible();
      await backButton.click();

      await expect(detailPanel).not.toBeVisible();

      const activityFeed = page.locator(".activity-feed");
      await expect(activityFeed).toBeVisible();
    });
  });

  test.describe("Historical Logs Display", () => {
    test("subtask detail panel shows historical logs", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "DONE", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);

      const historicalLogs = [
        "[10:30:00] Agent started",
        "[10:30:05] Reading file src/index.ts",
        "[10:30:10] Writing file src/utils.ts",
        "[10:30:15] Running tests",
        "[10:30:20] All tests passed",
        "[10:30:25] Agent completed successfully"
      ];

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: historicalLogs })
        });
      });

      await page.goto("/");
      await selectTask(page);
      await clickSubtaskNode(page);

      const detailPanel = page.locator(".subtask-detail-panel");
      await expect(detailPanel).toBeVisible({ timeout: 10000 });

      const logsContent = detailPanel.locator(".logs-content");
      await expect(logsContent).toBeVisible();

      for (const log of historicalLogs) {
        await expect(logsContent).toContainText(log.substring(0, 20));
      }
    });

    test("shows loading state while fetching logs", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "DONE", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);

      await page.route("**/api/tasks/**/subtasks/**/logs", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: ["Log line 1"] })
        });
      });

      await page.goto("/");
      await selectTask(page);
      await clickSubtaskNode(page);

      const loadingIndicator = page.locator(".logs-loading");
      await expect(loadingIndicator).toBeVisible();
      await expect(loadingIndicator).toContainText("Loading logs");

      await expect(loadingIndicator).not.toBeVisible({ timeout: 5000 });
    });

    test("shows empty state when no logs available", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: [] })
        });
      });

      await page.goto("/");
      await selectTask(page);
      await clickSubtaskNode(page);

      const detailPanel = page.locator(".subtask-detail-panel");
      await expect(detailPanel).toBeVisible({ timeout: 10000 });

      const emptyState = detailPanel.locator(".logs-empty");
      await expect(emptyState).toBeVisible();
      await expect(emptyState).toContainText("No logs available");
    });
  });

  test.describe("Real-time Log Streaming", () => {
    test("logs stream in real-time when agent is active", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "INPROGRESS", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);

      let wsServer: { send: (data: string) => void } | null = null;

      await page.routeWebSocket("ws://localhost:3001/api/events", (ws) => {
        wsServer = ws;
        ws.onMessage(() => {});

        setTimeout(() => {
          ws.send(JSON.stringify({ type: "state", data: state }));
        }, 50);
      });

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: ["Initial log line"] })
        });
      });

      await page.goto("/");
      await selectTask(page);
      await clickSubtaskNode(page);

      const detailPanel = page.locator(".subtask-detail-panel");
      await expect(detailPanel).toBeVisible({ timeout: 10000 });

      const logsContent = detailPanel.locator(".logs-content");
      await expect(logsContent).toContainText("Initial log line");

      wsServer?.send(
        JSON.stringify({
          type: "agentStarted",
          agentId: "agent-001",
          taskFolder: "test-task",
          subtaskFile: "001-subtask-1.md",
          agentType: "implementation"
        })
      );

      const agentIndicator = detailPanel.locator(".agent-active-indicator");
      await expect(agentIndicator).toBeVisible({ timeout: 5000 });

      wsServer?.send(
        JSON.stringify({
          type: "agentOutput",
          agentId: "agent-001",
          chunk: "New streamed log line from agent"
        })
      );

      await expect(logsContent).toContainText("New streamed log line", {
        timeout: 5000
      });
    });

    test("shows agent active indicator when agent is working", async ({
      page
    }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "INPROGRESS", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);

      let wsServer: { send: (data: string) => void } | null = null;

      await page.routeWebSocket("ws://localhost:3001/api/events", (ws) => {
        wsServer = ws;
        ws.onMessage(() => {});

        setTimeout(() => {
          ws.send(JSON.stringify({ type: "state", data: state }));
        }, 50);
      });

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: [] })
        });
      });

      await page.goto("/");
      await selectTask(page);
      await clickSubtaskNode(page);

      const detailPanel = page.locator(".subtask-detail-panel");
      await expect(detailPanel).toBeVisible({ timeout: 10000 });

      const agentIndicator = detailPanel.locator(".agent-active-indicator");
      await expect(agentIndicator).not.toBeVisible();

      wsServer?.send(
        JSON.stringify({
          type: "agentStarted",
          agentId: "agent-001",
          taskFolder: "test-task",
          subtaskFile: "001-subtask-1.md",
          agentType: "implementation"
        })
      );

      await expect(agentIndicator).toBeVisible({ timeout: 5000 });
      await expect(agentIndicator).toContainText("Agent active");
    });
  });

  test.describe("Node Selection Visual Feedback", () => {
    test("selected subtask node is visually highlighted", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] }),
        createMockSubtask({
          number: 2,
          status: "INPROGRESS",
          dependencies: [1]
        })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: [] })
        });
      });

      await page.goto("/");
      await selectTask(page);

      const firstNode = page.locator(".dag-view svg g[role='button']").first();
      const firstRect = firstNode.locator("rect").first();

      await expect(firstRect).toHaveAttribute("stroke-width", "2");

      await firstNode.click();

      await expect(firstRect).toHaveAttribute("stroke-width", "3");
      await expect(firstRect).toHaveCSS("stroke", "rgb(59, 130, 246)");
    });

    test("clicking a different node changes selection", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] }),
        createMockSubtask({ number: 2, status: "PENDING", dependencies: [1] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: [] })
        });
      });

      await page.goto("/");
      await selectTask(page);

      const nodeGroups = page.locator(".dag-view svg g[role='button']");
      const firstNode = nodeGroups.first();
      const secondNode = nodeGroups.nth(1);

      await firstNode.click();

      const firstRect = firstNode.locator("rect").first();
      await expect(firstRect).toHaveAttribute("stroke-width", "3");

      await secondNode.click();

      await expect(firstRect).toHaveAttribute("stroke-width", "2");

      const secondRect = secondNode.locator("rect").first();
      await expect(secondRect).toHaveAttribute("stroke-width", "3");

      const detailPanel = page.locator(".subtask-detail-panel");
      await expect(detailPanel.locator(".subtask-title-header")).toContainText(
        "Subtask #2"
      );
    });

    test("node is deselected when back button is clicked", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);

      await page.route("**/api/tasks/**/subtasks/**/logs", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ logs: [] })
        });
      });

      await page.goto("/");
      await selectTask(page);

      const node = page.locator(".dag-view svg g[role='button']").first();
      const nodeRect = node.locator("rect").first();

      await node.click();
      await expect(nodeRect).toHaveAttribute("stroke-width", "3");

      const backButton = page.locator(".subtask-detail-panel .back-button");
      await backButton.click();

      await expect(nodeRect).toHaveAttribute("stroke-width", "2");
    });
  });
});
