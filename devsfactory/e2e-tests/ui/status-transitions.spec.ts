import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type { OrchestratorState, ServerEvent } from "../../packages/dashboard/types";
import { createMockOrchestratorState, createMockTask, mockStateApi } from "./fixtures";

const injectMockWebSocket = async (page: Page, initialState: OrchestratorState) => {
  await page.addInitScript((state) => {
    type MockWsInstance = {
      readyState: number;
      onmessage: ((ev: MessageEvent) => void) | null;
    };
    const instances: MockWsInstance[] = [];
    (window as { __mockWsInstances?: MockWsInstance[] }).__mockWsInstances = instances;

    class MockWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;

      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSING = 2;
      readonly CLOSED = 3;

      url: string;
      readyState: number = MockWebSocket.CONNECTING;
      onopen: ((ev: Event) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;

      constructor(url: string | URL) {
        this.url = url.toString();
        instances.push(this);

        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          if (this.onopen) {
            this.onopen(new Event("open"));
          }

          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage(new MessageEvent("message", {
                data: JSON.stringify({ type: "state", data: state })
              }));
            }
          }, 10);
        }, 0);
      }

      send() {}
      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) {
          this.onclose(new CloseEvent("close", { code: 1000 }));
        }
      }

      addEventListener(type: string, listener: EventListener) {
        if (type === "open") this.onopen = listener as (ev: Event) => void;
        if (type === "close") this.onclose = listener as (ev: CloseEvent) => void;
        if (type === "message") this.onmessage = listener as (ev: MessageEvent) => void;
        if (type === "error") this.onerror = listener as (ev: Event) => void;
      }

      removeEventListener() {}
    }

    (window as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket;
  }, initialState);
};

const simulateWebSocketEvent = async (page: Page, event: ServerEvent) => {
  await page.evaluate((eventData) => {
    type MockWsInstance = {
      readyState: number;
      onmessage: ((ev: MessageEvent) => void) | null;
    };
    const instances = (window as { __mockWsInstances?: MockWsInstance[] }).__mockWsInstances ?? [];
    for (const ws of instances) {
      if (ws.readyState === 1 && ws.onmessage) {
        ws.onmessage(new MessageEvent("message", {
          data: JSON.stringify(eventData)
        }));
      }
    }
  }, event);
};

const setupPage = async (page: Page, mockState: OrchestratorState) => {
  await injectMockWebSocket(page, mockState);
  await mockStateApi(page, mockState);
  await page.goto("/");

  await page.waitForFunction(
    () => {
      const instances = (window as { __mockWsInstances?: { readyState: number }[] }).__mockWsInstances ?? [];
      return instances.length > 0 && instances[0].readyState === 1;
    },
    { timeout: 5000 }
  );
};

test.describe("Status Toggle Buttons", () => {
  test("renders Start button for BACKLOG status", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "backlog-task", title: "Backlog Task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    const taskCard = page.locator(".task-card");
    await expect(taskCard).toBeVisible();

    const statusToggle = taskCard.locator(".status-toggle");
    await expect(statusToggle).toBeVisible();
    await expect(statusToggle).toHaveText("Start");
    await expect(statusToggle).toHaveClass(/status-toggle-backlog/);
  });

  test("renders Defer button for PENDING status", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "pending-task", title: "Pending Task", status: "PENDING" })]
    });
    await setupPage(page, mockState);

    const statusToggle = page.locator(".status-toggle");
    await expect(statusToggle).toBeVisible();
    await expect(statusToggle).toHaveText("Defer");
    await expect(statusToggle).toHaveClass(/status-toggle-pending/);
  });

  test("renders Unblock button for BLOCKED status", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "blocked-task", title: "Blocked Task", status: "BLOCKED" })]
    });
    await setupPage(page, mockState);

    const statusToggle = page.locator(".status-toggle");
    await expect(statusToggle).toBeVisible();
    await expect(statusToggle).toHaveText("Unblock");
    await expect(statusToggle).toHaveClass(/status-toggle-blocked/);
  });

  test("does not render toggle button for INPROGRESS status", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "inprogress-task", title: "In Progress Task", status: "INPROGRESS" })]
    });
    await setupPage(page, mockState);

    const taskCard = page.locator(".task-card");
    await expect(taskCard).toBeVisible();

    const statusToggle = taskCard.locator(".status-toggle");
    await expect(statusToggle).not.toBeVisible();
  });

  test("does not render toggle button for DONE status", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "done-task", title: "Done Task", status: "DONE" })]
    });
    await setupPage(page, mockState);

    const taskCard = page.locator(".task-card");
    await expect(taskCard).toBeVisible();

    const statusToggle = taskCard.locator(".status-toggle");
    await expect(statusToggle).not.toBeVisible();
  });

  test("does not render toggle button for REVIEW status", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "review-task", title: "Review Task", status: "REVIEW" })]
    });
    await setupPage(page, mockState);

    const taskCard = page.locator(".task-card");
    await expect(taskCard).toBeVisible();

    const statusToggle = taskCard.locator(".status-toggle");
    await expect(statusToggle).not.toBeVisible();
  });
});

test.describe("Status API Calls", () => {
  test("clicking Start button triggers POST to status API with PENDING", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", title: "Test Task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    let apiCallMade = false;
    let requestBody: unknown = null;
    let requestUrl = "";

    await page.route("**/api/tasks/*/status", async (route) => {
      apiCallMade = true;
      requestUrl = route.request().url();
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    await statusToggle.click();

    await page.waitForTimeout(100);

    expect(apiCallMade).toBe(true);
    expect(requestUrl).toContain("/api/tasks/test-task/status");
    expect(requestBody).toEqual({ status: "PENDING" });
  });

  test("clicking Defer button triggers POST to status API with BACKLOG", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", title: "Test Task", status: "PENDING" })]
    });
    await setupPage(page, mockState);

    let requestBody: unknown = null;

    await page.route("**/api/tasks/*/status", async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    await statusToggle.click();

    await page.waitForTimeout(100);

    expect(requestBody).toEqual({ status: "BACKLOG" });
  });

  test("clicking Unblock button triggers POST to status API with PENDING", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "blocked-task", title: "Blocked Task", status: "BLOCKED" })]
    });
    await setupPage(page, mockState);

    let requestBody: unknown = null;
    let requestUrl = "";

    await page.route("**/api/tasks/*/status", async (route) => {
      requestUrl = route.request().url();
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    await statusToggle.click();

    await page.waitForTimeout(100);

    expect(requestUrl).toContain("/api/tasks/blocked-task/status");
    expect(requestBody).toEqual({ status: "PENDING" });
  });
});

test.describe("UI Updates After Status Change", () => {
  test("status badge updates when server sends taskChanged event", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", title: "Test Task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    await page.route("**/api/tasks/*/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusBadge = page.locator(".status-badge");
    await expect(statusBadge).toHaveText("BACKLOG");

    const statusToggle = page.locator(".status-toggle");
    await statusToggle.click();

    await simulateWebSocketEvent(page, {
      type: "taskChanged",
      task: createMockTask({ folder: "test-task", title: "Test Task", status: "PENDING" })
    });

    await expect(statusBadge).toHaveText("PENDING");
  });

  test("toggle button updates after status transition", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", title: "Test Task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    await page.route("**/api/tasks/*/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    await expect(statusToggle).toHaveText("Start");

    await statusToggle.click();

    await simulateWebSocketEvent(page, {
      type: "taskChanged",
      task: createMockTask({ folder: "test-task", title: "Test Task", status: "PENDING" })
    });

    await expect(statusToggle).toHaveText("Defer");
  });

  test("toggle button disappears when transitioning to status with no transitions", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", title: "Test Task", status: "PENDING" })]
    });
    await setupPage(page, mockState);

    await page.route("**/api/tasks/*/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    await expect(statusToggle).toBeVisible();

    await simulateWebSocketEvent(page, {
      type: "taskChanged",
      task: createMockTask({ folder: "test-task", title: "Test Task", status: "INPROGRESS" })
    });

    await expect(statusToggle).not.toBeVisible();
  });
});

test.describe("Error Handling", () => {
  test("handles API error gracefully", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", title: "Test Task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    await page.route("**/api/tasks/*/status", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid status transition" })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    const statusBadge = page.locator(".status-badge");

    await expect(statusBadge).toHaveText("BACKLOG");
    await statusToggle.click();

    await page.waitForTimeout(100);

    await expect(statusBadge).toHaveText("BACKLOG");
  });

  test("handles server error (500) gracefully", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", title: "Test Task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    await page.route("**/api/tasks/*/status", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    const statusBadge = page.locator(".status-badge");

    await expect(statusBadge).toHaveText("BACKLOG");
    await statusToggle.click();

    await page.waitForTimeout(100);

    await expect(statusBadge).toHaveText("BACKLOG");
    await expect(statusToggle).toBeVisible();
    await expect(statusToggle).toHaveText("Start");
  });

  test("handles network timeout gracefully", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", title: "Test Task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    await page.route("**/api/tasks/*/status", async (route) => {
      await route.abort("timedout");
    });

    const statusToggle = page.locator(".status-toggle");
    const statusBadge = page.locator(".status-badge");

    await expect(statusBadge).toHaveText("BACKLOG");
    await statusToggle.click();

    await page.waitForTimeout(100);

    await expect(statusBadge).toHaveText("BACKLOG");
    await expect(statusToggle).toBeVisible();
  });
});

test.describe("Valid Status Transitions", () => {
  test("BACKLOG can transition to PENDING", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    let targetStatus: string | undefined;

    await page.route("**/api/tasks/*/status", async (route) => {
      const body = route.request().postDataJSON() as { status: string };
      targetStatus = body.status;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    await expect(statusToggle).toHaveText("Start");
    await statusToggle.click();

    await page.waitForTimeout(100);

    expect(targetStatus).toBe("PENDING");
  });

  test("PENDING can transition to BACKLOG", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", status: "PENDING" })]
    });
    await setupPage(page, mockState);

    let targetStatus: string | undefined;

    await page.route("**/api/tasks/*/status", async (route) => {
      const body = route.request().postDataJSON() as { status: string };
      targetStatus = body.status;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    await expect(statusToggle).toHaveText("Defer");
    await statusToggle.click();

    await page.waitForTimeout(100);

    expect(targetStatus).toBe("BACKLOG");
  });

  test("BLOCKED can transition to PENDING", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", status: "BLOCKED" })]
    });
    await setupPage(page, mockState);

    let targetStatus: string | undefined;

    await page.route("**/api/tasks/*/status", async (route) => {
      const body = route.request().postDataJSON() as { status: string };
      targetStatus = body.status;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    await expect(statusToggle).toHaveText("Unblock");
    await statusToggle.click();

    await page.waitForTimeout(100);

    expect(targetStatus).toBe("PENDING");
  });

  test("round-trip: BACKLOG → PENDING → BACKLOG", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", title: "Test Task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    await page.route("**/api/tasks/*/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const statusToggle = page.locator(".status-toggle");
    const statusBadge = page.locator(".status-badge");

    await expect(statusBadge).toHaveText("BACKLOG");
    await expect(statusToggle).toHaveText("Start");

    await statusToggle.click();
    await simulateWebSocketEvent(page, {
      type: "taskChanged",
      task: createMockTask({ folder: "test-task", title: "Test Task", status: "PENDING" })
    });

    await expect(statusBadge).toHaveText("PENDING");
    await expect(statusToggle).toHaveText("Defer");

    await statusToggle.click();
    await simulateWebSocketEvent(page, {
      type: "taskChanged",
      task: createMockTask({ folder: "test-task", title: "Test Task", status: "BACKLOG" })
    });

    await expect(statusBadge).toHaveText("BACKLOG");
    await expect(statusToggle).toHaveText("Start");
  });
});

test.describe("Multiple Tasks Status Independence", () => {
  test("each task has independent status controls", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [
        createMockTask({ folder: "task-1", title: "Task 1", status: "BACKLOG" }),
        createMockTask({ folder: "task-2", title: "Task 2", status: "PENDING" }),
        createMockTask({ folder: "task-3", title: "Task 3", status: "BLOCKED" })
      ]
    });
    await setupPage(page, mockState);

    const taskCards = page.locator(".task-card");
    await expect(taskCards).toHaveCount(3);

    const task1Toggle = taskCards.nth(0).locator(".status-toggle");
    const task2Toggle = taskCards.nth(1).locator(".status-toggle");
    const task3Toggle = taskCards.nth(2).locator(".status-toggle");

    await expect(task1Toggle).toHaveText("Start");
    await expect(task2Toggle).toHaveText("Defer");
    await expect(task3Toggle).toHaveText("Unblock");
  });

  test("clicking one task toggle does not affect others", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [
        createMockTask({ folder: "task-1", title: "Task 1", status: "BACKLOG" }),
        createMockTask({ folder: "task-2", title: "Task 2", status: "BACKLOG" })
      ]
    });
    await setupPage(page, mockState);

    let clickedTaskFolder = "";

    await page.route("**/api/tasks/*/status", async (route) => {
      const url = route.request().url();
      const match = url.match(/\/api\/tasks\/([^/]+)\/status/);
      if (match) {
        clickedTaskFolder = match[1];
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const taskCards = page.locator(".task-card");
    const task1Toggle = taskCards.nth(0).locator(".status-toggle");

    await task1Toggle.click();
    await page.waitForTimeout(100);

    expect(clickedTaskFolder).toBe("task-1");

    const task2Badge = taskCards.nth(1).locator(".status-badge");
    await expect(task2Badge).toHaveText("BACKLOG");
  });
});

test.describe("Status Badge Display", () => {
  test("status badge shows current status", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "test-task", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    const statusBadge = page.locator(".status-badge");
    await expect(statusBadge).toHaveText("BACKLOG");
    await expect(statusBadge).toHaveClass(/status-backlog/);
  });

  test("status badge has correct class for each status", async ({ page }) => {
    const statuses: Array<{ status: "BACKLOG" | "PENDING" | "INPROGRESS" | "BLOCKED" | "DONE"; expectedClass: string }> = [
      { status: "BACKLOG", expectedClass: "status-backlog" },
      { status: "PENDING", expectedClass: "status-pending" },
      { status: "INPROGRESS", expectedClass: "status-inprogress" },
      { status: "BLOCKED", expectedClass: "status-blocked" },
      { status: "DONE", expectedClass: "status-done" }
    ];

    for (const { status, expectedClass } of statuses) {
      const mockState = createMockOrchestratorState({
        tasks: [createMockTask({ folder: "test-task", status })]
      });
      await setupPage(page, mockState);

      const statusBadge = page.locator(".status-badge");
      await expect(statusBadge).toHaveText(status);
      await expect(statusBadge).toHaveClass(new RegExp(expectedClass));
    }
  });
});

test.describe("Click Event Propagation", () => {
  test("clicking status toggle does not select the task card", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [
        createMockTask({ folder: "task-1", status: "BACKLOG" }),
        createMockTask({ folder: "task-2", status: "PENDING" })
      ]
    });
    await setupPage(page, mockState);

    await page.route("**/api/tasks/*/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true })
      });
    });

    const taskCards = page.locator(".task-card");
    const task1Card = taskCards.nth(0);
    const task1Toggle = task1Card.locator(".status-toggle");

    await expect(task1Card).not.toHaveClass(/selected/);

    await task1Toggle.click();
    await page.waitForTimeout(100);

    await expect(task1Card).not.toHaveClass(/selected/);
  });

  test("clicking task card (not toggle) selects the task", async ({ page }) => {
    const mockState = createMockOrchestratorState({
      tasks: [createMockTask({ folder: "task-1", status: "BACKLOG" })]
    });
    await setupPage(page, mockState);

    const taskCard = page.locator(".task-card");
    await expect(taskCard).not.toHaveClass(/selected/);

    await taskCard.click();

    await expect(taskCard).toHaveClass(/selected/);
  });
});
