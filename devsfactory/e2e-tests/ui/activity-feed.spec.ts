import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import type { ServerEvent, OrchestratorState } from "../../packages/dashboard/types";
import { createMockOrchestratorState, mockStateApi } from "./fixtures";

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

const setupPageWithAgents = async (
  page: Page,
  mockState: OrchestratorState
) => {
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

test.describe("Activity Feed", () => {
  test("renders activity feed container", async ({ dashboardPage }) => {
    const feed = dashboardPage.locator(".activity-feed");
    await expect(feed).toBeVisible();
    await expect(feed.locator("h3")).toHaveText("Activity Feed");
  });

  test("shows empty state when no agents are active", async ({ dashboardPage }) => {
    const emptyMessage = dashboardPage.locator(".activity-feed-empty");
    await expect(emptyMessage).toHaveText("No active agents");
  });
});

test.describe("Activity Feed with Active Agents", () => {
  test("renders agent tabs when agents become active", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      subtaskFile: "001-setup.md",
      agentType: "implementation"
    });

    const agentTab = page.locator(".agent-tab");
    await expect(agentTab).toBeVisible();
    await expect(agentTab).toHaveText("agent-001");
  });

  test("shows event list when agent has output", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      subtaskFile: "001-setup.md",
      agentType: "implementation"
    });

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-001",
      chunk: "Agent started (implementation)"
    });

    const agentTab = page.locator(".agent-tab");
    await agentTab.click();

    const summaryView = page.locator(".summary-view");
    await expect(summaryView).toBeVisible();

    const eventLine = page.locator(".event-line");
    await expect(eventLine).toBeVisible();
    await expect(eventLine).toContainText("Agent started (implementation)");
  });

  test("displays multiple events in chronological order", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    const events = [
      "Agent started (implementation)",
      "[Read] src/index.ts",
      "[Edit] src/utils.ts",
      "[Bash] bun test"
    ];

    for (const chunk of events) {
      await simulateWebSocketEvent(page, {
        type: "agentOutput",
        agentId: "agent-001",
        chunk
      });
    }

    await page.locator(".agent-tab").click();

    const eventLines = page.locator(".event-line");
    await expect(eventLines).toHaveCount(events.length);

    for (let i = 0; i < events.length; i++) {
      await expect(eventLines.nth(i)).toContainText(events[i]);
    }
  });
});

test.describe("Event Timestamps", () => {
  test("displays timestamps in HH:MM:SS format", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-001",
      chunk: "Test action"
    });

    await page.locator(".agent-tab").click();

    const timestamp = page.locator(".event-timestamp");
    await expect(timestamp).toBeVisible();

    const timestampText = await timestamp.textContent();
    expect(timestampText).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test("each event shows its own timestamp", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-001",
      chunk: "First action"
    });

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-001",
      chunk: "Second action"
    });

    await page.locator(".agent-tab").click();

    const timestamps = page.locator(".event-timestamp");
    await expect(timestamps).toHaveCount(2);
  });
});

test.describe("Pin/Focus Toggle", () => {
  test("shows following indicator when agent is focused but not pinned", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await page.locator(".agent-tab").click();

    const followingIndicator = page.locator(".following-indicator");
    await expect(followingIndicator).toBeVisible();
    await expect(followingIndicator).toHaveText("following");
  });

  test("shows pin button when agent is focused", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await page.locator(".agent-tab").click();

    const pinButton = page.locator(".pin-button");
    await expect(pinButton).toBeVisible();
    await expect(pinButton).toHaveText("pin");
  });

  test("clicking pin button toggles pinned state", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await page.locator(".agent-tab").click();

    const pinButton = page.locator(".pin-button");
    await expect(pinButton).toHaveText("pin");
    await expect(pinButton).not.toHaveClass(/pinned/);

    await pinButton.click();
    await expect(pinButton).toHaveText("pinned");
    await expect(pinButton).toHaveClass(/pinned/);

    const followingIndicator = page.locator(".following-indicator");
    await expect(followingIndicator).not.toBeVisible();
  });

  test("unpinning restores following indicator", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await page.locator(".agent-tab").click();

    const pinButton = page.locator(".pin-button");
    await pinButton.click();
    await expect(pinButton).toHaveClass(/pinned/);

    await pinButton.click();
    await expect(pinButton).not.toHaveClass(/pinned/);
    await expect(pinButton).toHaveText("pin");

    const followingIndicator = page.locator(".following-indicator");
    await expect(followingIndicator).toBeVisible();
  });
});

test.describe("Auto-scroll Behavior", () => {
  test("summary view scrolls to bottom when new events arrive", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    for (let i = 0; i < 20; i++) {
      await simulateWebSocketEvent(page, {
        type: "agentOutput",
        agentId: "agent-001",
        chunk: `Event line ${i + 1}`
      });
    }

    await page.locator(".agent-tab").click();

    await page.waitForTimeout(100);

    const summaryView = page.locator(".summary-view");
    const isScrolledToBottom = await summaryView.evaluate((el) => {
      const threshold = 5;
      return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    });

    expect(isScrolledToBottom).toBe(true);
  });

  test("new events added while scrolled trigger auto-scroll", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    for (let i = 0; i < 10; i++) {
      await simulateWebSocketEvent(page, {
        type: "agentOutput",
        agentId: "agent-001",
        chunk: `Initial event ${i + 1}`
      });
    }

    await page.locator(".agent-tab").click();

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-001",
      chunk: "New event after focus"
    });

    await page.waitForTimeout(100);

    const lastEvent = page.locator(".event-line").last();
    await expect(lastEvent).toContainText("New event after focus");

    const summaryView = page.locator(".summary-view");
    const isScrolledToBottom = await summaryView.evaluate((el) => {
      const threshold = 5;
      return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    });

    expect(isScrolledToBottom).toBe(true);
  });
});

test.describe("Multiple Agents", () => {
  test("renders tabs for multiple active agents", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-002",
      taskFolder: "task-2",
      agentType: "review"
    });

    const agentTabs = page.locator(".agent-tab");
    await expect(agentTabs).toHaveCount(2);
    await expect(agentTabs.nth(0)).toHaveText("agent-001");
    await expect(agentTabs.nth(1)).toHaveText("agent-002");
  });

  test("clicking agent tab switches focus to that agent", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-002",
      taskFolder: "task-2",
      agentType: "review"
    });

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-001",
      chunk: "Agent 1 action"
    });

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-002",
      chunk: "Agent 2 action"
    });

    const firstTab = page.locator(".agent-tab").first();
    await firstTab.click();
    await expect(firstTab).toHaveClass(/focused/);
    await expect(page.locator(".event-line")).toContainText("Agent 1 action");

    const secondTab = page.locator(".agent-tab").nth(1);
    await secondTab.click();
    await expect(secondTab).toHaveClass(/focused/);
    await expect(firstTab).not.toHaveClass(/focused/);
    await expect(page.locator(".event-line")).toContainText("Agent 2 action");
  });

  test("agent tab removed when agent completes", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-002",
      taskFolder: "task-2",
      agentType: "review"
    });

    let agentTabs = page.locator(".agent-tab");
    await expect(agentTabs).toHaveCount(2);

    await simulateWebSocketEvent(page, {
      type: "agentCompleted",
      agentId: "agent-001",
      exitCode: 0
    });

    agentTabs = page.locator(".agent-tab");
    await expect(agentTabs).toHaveCount(1);
    await expect(agentTabs.first()).toHaveText("agent-002");
  });
});

test.describe("Real-time Updates", () => {
  test("events appear immediately as agent outputs arrive", async ({ page }) => {
    const mockState = createMockOrchestratorState();
    await setupPageWithAgents(page, mockState);

    await simulateWebSocketEvent(page, {
      type: "agentStarted",
      agentId: "agent-001",
      taskFolder: "task-1",
      agentType: "implementation"
    });

    await page.locator(".agent-tab").click();

    await expect(page.locator(".event-line")).toHaveCount(0);

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-001",
      chunk: "First event"
    });

    await expect(page.locator(".event-line")).toHaveCount(1);

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-001",
      chunk: "Second event"
    });

    await expect(page.locator(".event-line")).toHaveCount(2);

    await simulateWebSocketEvent(page, {
      type: "agentOutput",
      agentId: "agent-001",
      chunk: "Third event"
    });

    await expect(page.locator(".event-line")).toHaveCount(3);
  });
});
