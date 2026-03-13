import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { setupDashboardDom } from "./test/setup-dom";

setupDashboardDom();

mock.module("./hooks/useTaskEvents", () => ({
  useTaskEvents: () => ({
    tasks: [],
    capacity: { working: 0, max: 3 },
    repos: [],
    connected: true,
    initialized: true,
    refresh: () => {},
  }),
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
  ) as unknown as typeof globalThis.fetch;
});

const { App } = await import("./App");

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

const renderApp = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root.render(<App />));
};

describe("App shell scroll layout", () => {
  test("content wrapper allows overflow scrolling", () => {
    renderApp();
    const shell = container.firstElementChild as HTMLElement;
    const contentWrapper = shell?.children[0] as HTMLElement;

    expect(contentWrapper.className).toContain("overflow-auto");
    expect(contentWrapper.className).not.toContain("overflow-hidden");
  });

  test("shell uses h-screen with flex column layout", () => {
    renderApp();
    const shell = container.firstElementChild as HTMLElement;

    expect(shell.className).toContain("h-screen");
    expect(shell.className).toContain("flex");
    expect(shell.className).toContain("flex-col");
  });
});
