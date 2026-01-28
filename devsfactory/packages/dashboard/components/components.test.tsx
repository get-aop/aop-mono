import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { StoreContext } from "../context";
import { createDashboardStore } from "../store";
import { App } from "./App";
import { Header } from "./Header";
import { Layout } from "./Layout";

const renderWithStore = (component: React.ReactNode) => {
  const store = createDashboardStore();
  return renderToString(
    <StoreContext.Provider value={store}>{component}</StoreContext.Provider>
  );
};

describe("Header", () => {
  test("renders title 'Devsfactory'", () => {
    const html = renderWithStore(<Header />);
    expect(html).toContain("Devsfactory");
  });

  test("shows connection status indicator", () => {
    const html = renderWithStore(<Header />);
    expect(html).toContain("disconnected");
  });

  test("shows debug toggle", () => {
    const html = renderWithStore(<Header />);
    expect(html).toContain("debug");
  });
});

describe("Layout", () => {
  test("renders three-panel layout structure", () => {
    const html = renderWithStore(<Layout />);
    expect(html).toContain("sidebar");
    expect(html).toContain("main");
    expect(html).toContain("feed");
  });

  test("sidebar shows task list heading", () => {
    const html = renderWithStore(<Layout />);
    expect(html).toContain("Task List");
  });

  test("sidebar integrates TaskList component", () => {
    const html = renderWithStore(<Layout />);
    expect(html).toContain("task-list");
  });

  test("main area shows task detail placeholder", () => {
    const html = renderWithStore(<Layout />);
    expect(html).toContain("Task Detail");
  });

  test("feed area contains ActivityFeed component", () => {
    const html = renderWithStore(<Layout />);
    expect(html).toContain("activity-feed");
  });
});

describe("App", () => {
  test("renders Header component", () => {
    const html = renderWithStore(<App />);
    expect(html).toContain("Devsfactory");
  });

  test("renders Layout component", () => {
    const html = renderWithStore(<App />);
    expect(html).toContain("sidebar");
  });

  test("wraps content in app container", () => {
    const html = renderWithStore(<App />);
    expect(html).toContain('class="app');
  });
});
