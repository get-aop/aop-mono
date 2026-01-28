import { test as base, type Page } from "@playwright/test";
import type { OrchestratorState } from "../../../packages/dashboard/types";
import { createMockOrchestratorState, mockApiResponse } from "./test-helpers";

export interface DashboardFixtures {
  mockState: OrchestratorState;
  dashboardPage: Page;
}

export const test = base.extend<DashboardFixtures>({
  mockState: async ({}, use) => {
    const state = createMockOrchestratorState();
    await use(state);
  },

  dashboardPage: async ({ page, mockState }, use) => {
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

    await mockApiResponse(page, "**/api/**", {});
    await page.goto("/");
    await page.waitForSelector(".layout");
    await use(page);
  }
});

export { expect } from "@playwright/test";
