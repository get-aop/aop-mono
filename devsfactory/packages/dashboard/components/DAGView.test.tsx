import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { StoreContext } from "../context";
import { createDashboardStore } from "../store";
import type { Subtask } from "../types";
import { DAGView } from "./DAGView";

const makeSubtask = (
  number: number,
  status: Subtask["frontmatter"]["status"] = "PENDING",
  dependencies: number[] = []
): Subtask => ({
  filename: `00${number}-test.md`,
  number,
  slug: "test",
  frontmatter: { title: `Subtask ${number}`, status, dependencies },
  description: ""
});

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("DAGView", () => {
  let store: ReturnType<typeof createDashboardStore>;

  const renderWithStore = (subtasks: Subtask[], storeInstance = store) =>
    render(
      <StoreContext.Provider value={storeInstance}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );

  beforeEach(() => {
    store = createDashboardStore();
  });

  test("renders SVG element", () => {
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={[]} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("<svg");
  });

  test("renders empty state for no subtasks", () => {
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={[]} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("svg");
  });

  test("renders nodes for each subtask", () => {
    const subtasks = [makeSubtask(1), makeSubtask(2)];
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("Subtask 1");
    expect(html).toContain("Subtask 2");
  });

  test("renders edges for dependencies", () => {
    const subtasks = [makeSubtask(1), makeSubtask(2, "PENDING", [1])];
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("<path");
  });

  test("includes arrow marker definition", () => {
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={[makeSubtask(1)]} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("<marker");
    expect(html).toContain('id="arrowhead"');
  });

  test("clicking node calls selectSubtask", () => {
    const subtasks = [makeSubtask(1)];
    const { container } = renderWithStore(subtasks);

    const node = container.querySelector("g[style*='cursor']");
    expect(node).not.toBeNull();

    fireEvent.click(node!);
  });

  test("shows pulse animation for subtask with active agent", () => {
    const subtasks = [makeSubtask(1, "INPROGRESS")];
    store.getState().updateFromServer({
      type: "agentStarted",
      agentId: "agent-1",
      taskFolder: "test-task",
      subtaskFile: "001-test.md",
      agentType: "implementation"
    });

    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain("dag-node-pulse");
  });

  test("does not show pulse for subtask without active agent", () => {
    const subtasks = [makeSubtask(1, "INPROGRESS")];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).not.toContain("dag-node-pulse");
  });

  test("renders dag-view class on container", () => {
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={[]} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("dag-view");
  });

  test("calculates viewBox based on node positions", () => {
    const subtasks = [makeSubtask(1), makeSubtask(2, "PENDING", [1])];
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("viewBox");
  });

  test("renders unblock button for BLOCKED subtasks", () => {
    const subtasks = [makeSubtask(1, "BLOCKED")];
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("Unblock");
    expect(html).toContain("dag-node-unblock");
  });

  test("does not render unblock button for non-BLOCKED subtasks", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).not.toContain("Unblock");
    expect(html).not.toContain("dag-node-unblock");
  });

  test("selected node has blue stroke and wider border", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const storeWithSelection = createDashboardStore(undefined, {
      selectedSubtask: { taskFolder: "test-task", subtaskFile: "001-test.md" }
    });

    const html = renderToString(
      <StoreContext.Provider value={storeWithSelection}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );

    expect(html).toContain('stroke="#3b82f6"');
    expect(html).toContain('stroke-width="3"');
  });

  test("unselected node has status-based stroke", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );

    expect(html).toContain('stroke="#9ca3af"');
    expect(html).toContain('stroke-width="2"');
  });

  test("only matching subtask is selected when multiple exist", () => {
    const subtasks = [makeSubtask(1, "PENDING"), makeSubtask(2, "PENDING")];
    const storeWithSelection = createDashboardStore(undefined, {
      selectedSubtask: { taskFolder: "test-task", subtaskFile: "001-test.md" }
    });

    const html = renderToString(
      <StoreContext.Provider value={storeWithSelection}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );

    const selectedCount = (html.match(/stroke-width="3"/g) || []).length;
    expect(selectedCount).toBe(1);

    const unselectedCount = (html.match(/stroke-width="2"/g) || []).length;
    expect(unselectedCount).toBe(1);
  });

  test("no nodes selected when taskFolder does not match", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const storeWithSelection = createDashboardStore(undefined, {
      selectedSubtask: {
        taskFolder: "different-task",
        subtaskFile: "001-test.md"
      }
    });

    const html = renderToString(
      <StoreContext.Provider value={storeWithSelection}>
        <DAGView subtasks={subtasks} taskFolder="test-task" />
      </StoreContext.Provider>
    );

    expect(html).not.toContain('stroke="#3b82f6"');
    expect(html).toContain('stroke-width="2"');
  });
});
