import type { Page } from "@playwright/test";
import type {
  OrchestratorState,
  Subtask
} from "../../packages/dashboard/types";
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

test.describe("Panel Switching", () => {
  test.describe("Default Panel View", () => {
    test("shows Activity Feed when no subtask is selected", async ({ page }) => {
      const subtasks = [
        createMockSubtask({ number: 1, status: "PENDING", dependencies: [] }),
        createMockSubtask({ number: 2, status: "INPROGRESS", dependencies: [1] })
      ];
      const state = createStateWithSubtasks(subtasks);
      await setupMockWebSocket(page, state);
      await page.goto("/");

      await selectTask(page);

      const feedSection = page.locator(".feed");
      await expect(feedSection).toBeVisible();

      const activityFeed = feedSection.locator(".activity-feed");
      await expect(activityFeed).toBeVisible();

      const subtaskDetailPanel = feedSection.locator(".subtask-detail-panel");
      await expect(subtaskDetailPanel).not.toBeVisible();
    });
  });

  test.describe("Subtask Selection Panel", () => {
    test("shows Subtask Detail Panel when subtask is selected", async ({
      page
    }) => {
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
          body: JSON.stringify({ logs: ["Log line 1", "Log line 2"] })
        });
      });

      await page.goto("/");

      await selectTask(page);

      const dagNode = page.locator(".dag-view svg g[role='button']").first();
      await expect(dagNode).toBeVisible();
      await dagNode.click();

      const nodeRect = dagNode.locator("rect").first();
      await expect(nodeRect).toHaveAttribute("stroke-width", "3", { timeout: 5000 });

      const feedSection = page.locator(".feed");
      const subtaskDetailPanel = feedSection.locator(".subtask-detail-panel");
      await expect(subtaskDetailPanel).toBeVisible({ timeout: 10000 });

      const activityFeed = feedSection.locator(".activity-feed");
      await expect(activityFeed).not.toBeVisible();
    });

    test("clicking back button returns to Activity Feed", async ({ page }) => {
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

      const dagNode = page.locator(".dag-view svg g[role='button']").first();
      await dagNode.click();

      const feedSection = page.locator(".feed");
      const subtaskDetailPanel = feedSection.locator(".subtask-detail-panel");
      await expect(subtaskDetailPanel).toBeVisible({ timeout: 10000 });

      const backButton = subtaskDetailPanel.locator(".back-button");
      await expect(backButton).toBeVisible();
      await backButton.click();

      await expect(subtaskDetailPanel).not.toBeVisible();

      const activityFeed = feedSection.locator(".activity-feed");
      await expect(activityFeed).toBeVisible();
    });
  });

  test.describe("Task Change Clears Selection", () => {
    test("selecting a different task clears subtask selection", async ({
      page
    }) => {
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

      const firstTaskCard = page.locator(".task-card").first();
      await expect(firstTaskCard).toBeVisible({ timeout: 10000 });
      await firstTaskCard.click();

      const dagNode = page.locator(".dag-view svg g[role='button']").first();
      await dagNode.click();

      const feedSection = page.locator(".feed");
      const subtaskDetailPanel = feedSection.locator(".subtask-detail-panel");
      await expect(subtaskDetailPanel).toBeVisible({ timeout: 10000 });

      const secondTaskCard = page.locator(".task-card").nth(1);
      await secondTaskCard.click();

      await expect(subtaskDetailPanel).not.toBeVisible();

      const activityFeed = feedSection.locator(".activity-feed");
      await expect(activityFeed).toBeVisible();
    });
  });
});
