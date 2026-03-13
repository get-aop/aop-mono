import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { setupDashboardDom } from "./test/setup-dom";

setupDashboardDom();

const renderToString = async (component: ReactElement): Promise<string> => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup(component);
};

const refresh = () => {};

mock.module("./hooks/useTaskEvents", () => ({
  useTaskEvents: () => ({
    tasks: [],
    capacity: { working: 0, max: 3 },
    repos: [],
    connected: true,
    initialized: true,
    refresh,
  }),
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
  ) as unknown as typeof globalThis.fetch;
});

const { App } = await import("./App");

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("App shell scroll layout", () => {
  test("content wrapper allows overflow scrolling", async () => {
    const html = await renderToString(<App />);

    expect(html).toContain("flex-1 overflow-auto");
    expect(html).not.toContain("overflow-hidden");
  });

  test("shell uses h-screen with flex column layout", async () => {
    const html = await renderToString(<App />);

    expect(html).toContain("flex h-screen flex-col");
  });
});
