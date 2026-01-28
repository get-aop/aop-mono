import { test, expect, mockApiResponse } from "./fixtures";

test.describe("Dashboard Layout", () => {
  test("loads successfully and shows header", async ({ dashboardPage }) => {
    await expect(dashboardPage.locator(".header")).toBeVisible();
    await expect(dashboardPage.locator(".header-title")).toHaveText("Devsfactory");
    await expect(dashboardPage.locator(".connection-status")).toBeVisible();
    await expect(dashboardPage.locator(".debug-toggle")).toBeVisible();
  });

  test("renders three-panel layout", async ({ dashboardPage }) => {
    const layout = dashboardPage.locator(".layout");
    await expect(layout).toBeVisible();

    const sidebar = dashboardPage.locator(".sidebar");
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator("h2")).toHaveText("Task List");

    const main = dashboardPage.locator(".main");
    await expect(main).toBeVisible();

    const feed = dashboardPage.locator(".feed");
    await expect(feed).toBeVisible();
  });

  test("layout uses CSS Grid with correct structure", async ({ dashboardPage }) => {
    const layout = dashboardPage.locator(".layout");
    const display = await layout.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("grid");

    const gridTemplateColumns = await layout.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns
    );
    expect(gridTemplateColumns).toMatch(/280px/);
  });
});

test.describe("Task List Navigation", () => {
  test("displays task cards for each task", async ({ dashboardPage, mockState }) => {
    const taskCards = dashboardPage.locator(".task-card");
    await expect(taskCards).toHaveCount(mockState.tasks.length);
  });

  test("clicking task card selects it", async ({ dashboardPage }) => {
    const firstCard = dashboardPage.locator(".task-card").first();
    const secondCard = dashboardPage.locator(".task-card").nth(1);

    await firstCard.locator(".task-card-title").click();
    await expect(firstCard).toHaveClass(/selected/);

    await secondCard.locator(".task-card-title").click();
    await expect(secondCard).toHaveClass(/selected/);
    await expect(firstCard).not.toHaveClass(/selected/);
  });

  test("selected task shows details in main area", async ({ dashboardPage, mockState }) => {
    const firstCard = dashboardPage.locator(".task-card").first();
    await firstCard.click();

    const main = dashboardPage.locator(".main");
    const taskTitle = mockState.tasks[0].frontmatter.title;
    await expect(main.locator("h2")).toHaveText(taskTitle);
  });

  test("shows empty state when no tasks", async ({ page }) => {
    const emptyState = { tasks: [], plans: {}, subtasks: {} };

    await page.addInitScript((stateData) => {
      const OriginalWebSocket = window.WebSocket;
      window.WebSocket = class extends OriginalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          setTimeout(() => {
            const mockEvent = new MessageEvent("message", {
              data: JSON.stringify({ type: "state", data: stateData })
            });
            this.dispatchEvent(mockEvent);
          }, 50);
        }
      } as typeof WebSocket;
    }, emptyState);

    await mockApiResponse(page, "**/api/**", {});
    await page.goto("/");
    await page.waitForSelector(".layout");

    const emptyMessage = page.locator(".task-list-empty");
    await expect(emptyMessage).toHaveText("No tasks");
  });
});

test.describe("Responsive Layout", () => {
  test("layout adapts to smaller viewport", async ({ dashboardPage }) => {
    await dashboardPage.setViewportSize({ width: 768, height: 600 });

    const layout = dashboardPage.locator(".layout");
    await expect(layout).toBeVisible();

    const sidebar = dashboardPage.locator(".sidebar");
    await expect(sidebar).toBeVisible();
  });

  test("layout adapts to larger viewport", async ({ dashboardPage }) => {
    await dashboardPage.setViewportSize({ width: 1920, height: 1080 });

    const layout = dashboardPage.locator(".layout");
    await expect(layout).toBeVisible();

    const sidebar = dashboardPage.locator(".sidebar");
    const sidebarWidth = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
    expect(sidebarWidth).toBe(280);
  });

  test("all three panels remain visible at different viewport sizes", async ({
    dashboardPage
  }) => {
    const viewportSizes = [
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 }
    ];

    for (const size of viewportSizes) {
      await dashboardPage.setViewportSize(size);

      await expect(dashboardPage.locator(".sidebar")).toBeVisible();
      await expect(dashboardPage.locator(".main")).toBeVisible();
      await expect(dashboardPage.locator(".feed")).toBeVisible();
    }
  });
});
