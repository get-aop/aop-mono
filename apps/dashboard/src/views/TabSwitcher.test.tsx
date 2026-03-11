import { afterEach, describe, expect, mock, test } from "bun:test";
import type { TaskStatus } from "@aop/common";
import { setupDashboardDom } from "../test/setup-dom";
import { type DetailTab, TabSwitcher } from "./TabSwitcher";

setupDashboardDom();

const { render, screen, cleanup } = await import("@testing-library/react");

afterEach(cleanup);

describe("TabSwitcher", () => {
  test("renders Specs and Logs tabs", () => {
    render(<TabSwitcher activeTab="specs" onTabChange={() => {}} isWorking={false} />);
    expect(screen.getByTestId("tab-specs")).toBeTruthy();
    expect(screen.getByTestId("tab-logs")).toBeTruthy();
    expect(screen.getByTestId("tab-specs").textContent).toContain("Specs");
    expect(screen.getByTestId("tab-logs").textContent).toContain("Logs");
  });

  test("highlights active tab with amber border", () => {
    render(<TabSwitcher activeTab="specs" onTabChange={() => {}} isWorking={false} />);
    expect(screen.getByTestId("tab-specs").className).toContain("border-aop-amber");
    expect(screen.getByTestId("tab-logs").className).not.toContain("border-aop-amber");
  });

  test("highlights logs tab when active", () => {
    render(<TabSwitcher activeTab="logs" onTabChange={() => {}} isWorking={false} />);
    expect(screen.getByTestId("tab-logs").className).toContain("border-aop-amber");
    expect(screen.getByTestId("tab-specs").className).not.toContain("border-aop-amber");
  });

  test("calls onTabChange when tab is clicked", () => {
    const onTabChange = mock<(tab: DetailTab) => void>();
    render(<TabSwitcher activeTab="specs" onTabChange={onTabChange} isWorking={false} />);
    screen.getByTestId("tab-logs").click();
    expect(onTabChange).toHaveBeenCalledWith("logs");
  });

  test("calls onTabChange with specs when Specs tab clicked", () => {
    const onTabChange = mock<(tab: DetailTab) => void>();
    render(<TabSwitcher activeTab="logs" onTabChange={onTabChange} isWorking={false} />);
    screen.getByTestId("tab-specs").click();
    expect(onTabChange).toHaveBeenCalledWith("specs");
  });
});

describe("TabSwitcher live indicator", () => {
  test("shows live indicator on Logs tab when working", () => {
    render(<TabSwitcher activeTab="specs" onTabChange={() => {}} isWorking={true} />);
    expect(screen.getByTestId("live-indicator")).toBeTruthy();
  });

  test("hides live indicator when not working", () => {
    render(<TabSwitcher activeTab="specs" onTabChange={() => {}} isWorking={false} />);
    expect(screen.queryByTestId("live-indicator")).toBeNull();
  });

  test("live indicator has pulse animation class", () => {
    render(<TabSwitcher activeTab="specs" onTabChange={() => {}} isWorking={true} />);
    expect(screen.getByTestId("live-indicator").className).toContain("pulse");
  });

  test("live indicator is on Logs tab even when Specs is active", () => {
    render(<TabSwitcher activeTab="specs" onTabChange={() => {}} isWorking={true} />);
    const logsTab = screen.getByTestId("tab-logs");
    const indicator = screen.getByTestId("live-indicator");
    expect(logsTab.contains(indicator)).toBe(true);
  });
});

const getDefaultTab = (status: TaskStatus): DetailTab => (status === "WORKING" ? "logs" : "specs");

describe("default tab logic", () => {
  test("WORKING status defaults to logs", () => {
    expect(getDefaultTab("WORKING")).toBe("logs");
  });

  test("DRAFT status defaults to specs", () => {
    expect(getDefaultTab("DRAFT")).toBe("specs");
  });

  test("DONE status defaults to specs", () => {
    expect(getDefaultTab("DONE")).toBe("specs");
  });

  test("BLOCKED status defaults to specs", () => {
    expect(getDefaultTab("BLOCKED")).toBe("specs");
  });
});
