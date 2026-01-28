import { test as base, expect, type Page } from "./fixtures";
import { mockApiResponse, createMockOrchestratorState } from "./fixtures";

interface NewTaskButtonFixtures {
  dashboardPageWithDrafts: Page;
}

const test = base.extend<NewTaskButtonFixtures>({
  dashboardPageWithDrafts: async ({ page }, use) => {
    const mockState = createMockOrchestratorState();

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
    }, mockState);

    await mockApiResponse(page, "**/api/brainstorm/drafts", {
      drafts: [
        {
          sessionId: "draft-1",
          title: "Test Draft",
          lastUpdated: new Date().toISOString(),
          messageCount: 5
        }
      ]
    });
    await mockApiResponse(page, "**/api/**", {});
    await page.goto("/");
    await page.waitForSelector(".layout");
    await use(page);
  }
});

test.describe("NewTaskButton Component", () => {
  test("renders in header controls", async ({ dashboardPage }) => {
    const button = dashboardPage.locator(".new-task-button");
    await expect(button).toBeVisible();
    await expect(button).toHaveText("+ New Task");
  });

  test("has correct styling", async ({ dashboardPage }) => {
    const button = dashboardPage.locator(".new-task-button");
    await expect(button).toBeVisible();

    const backgroundColor = await button.evaluate(
      (el) => getComputedStyle(el).backgroundColor
    );
    expect(backgroundColor).toBeTruthy();

    const cursor = await button.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe("pointer");
  });

  test("is positioned before connection status in header", async ({
    dashboardPage
  }) => {
    const headerControls = dashboardPage.locator(".header-controls");
    const children = headerControls.locator("> *");
    const count = await children.count();
    expect(count).toBeGreaterThanOrEqual(3);

    const firstChild = children.first();
    await expect(firstChild).toHaveClass(/new-task-button/);
  });

  test("opens modal on click", async ({ dashboardPage }) => {
    const button = dashboardPage.locator(".new-task-button");
    await button.click();

    await dashboardPage.waitForTimeout(100);

    const modalOpen = await dashboardPage.evaluate(() => {
      const store = (window as { __store__?: { getState: () => { brainstorm: { isModalOpen: boolean } } } }).__store__;
      return store?.getState()?.brainstorm?.isModalOpen ?? false;
    });
    expect(modalOpen).toBe(true);
  });

  test("shows draft indicator when drafts exist", async ({
    dashboardPageWithDrafts
  }) => {
    await dashboardPageWithDrafts.waitForTimeout(200);

    const button = dashboardPageWithDrafts.locator(".new-task-button");
    await expect(button).toBeVisible();

    const draftIndicator = button.locator(".draft-indicator");
    await expect(draftIndicator).toBeVisible();
  });

  test("does not show draft indicator when no drafts", async ({
    dashboardPage
  }) => {
    const button = dashboardPage.locator(".new-task-button");
    await expect(button).toBeVisible();

    const draftIndicator = button.locator(".draft-indicator");
    await expect(draftIndicator).not.toBeVisible();
  });

  test("hover state changes opacity", async ({ dashboardPage }) => {
    const button = dashboardPage.locator(".new-task-button");

    const initialOpacity = await button.evaluate(
      (el) => getComputedStyle(el).opacity
    );

    await button.hover();

    const hoverOpacity = await button.evaluate(
      (el) => getComputedStyle(el).opacity
    );

    expect(parseFloat(hoverOpacity)).toBeLessThanOrEqual(
      parseFloat(initialOpacity)
    );
  });
});
