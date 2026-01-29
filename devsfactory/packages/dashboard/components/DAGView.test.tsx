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

  test("renders React Flow container", () => {
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={[]} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("react-flow");
  });

  test("renders empty state for no subtasks", () => {
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={[]} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("react-flow");
  });

  test("renders nodes for each subtask", () => {
    const subtasks = [makeSubtask(1), makeSubtask(2)];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain("Subtask 1");
    expect(container.innerHTML).toContain("Subtask 2");
  });

  test("uses custom SubtaskNode component", () => {
    const subtasks = [makeSubtask(1)];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain(">#1<");
  });

  test("clicking node calls selectSubtask", () => {
    const subtasks = [makeSubtask(1)];
    const { container } = renderWithStore(subtasks);

    const node = container.querySelector('[role="button"]');
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

  test("renders unblock button for BLOCKED subtasks", () => {
    const subtasks = [makeSubtask(1, "BLOCKED")];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain("Unblock");
    expect(container.innerHTML).toContain("dag-node-unblock");
  });

  test("does not render unblock button for non-BLOCKED subtasks", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).not.toContain("Unblock");
    expect(container.innerHTML).not.toContain("dag-node-unblock");
  });

  test("selected node has blue border", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const storeWithSelection = createDashboardStore(undefined, {
      selectedSubtask: { taskFolder: "test-task", subtaskFile: "001-test.md" }
    });

    const { container } = renderWithStore(subtasks, storeWithSelection);
    expect(container.innerHTML).toContain("border-color: #3b82f6");
    expect(container.innerHTML).toContain("border-width: 3px");
  });

  test("unselected node has status-based border", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain("border-color: #9ca3af");
    expect(container.innerHTML).toContain("border-width: 2px");
  });

  test("only matching subtask is selected when multiple exist", () => {
    const subtasks = [makeSubtask(1, "PENDING"), makeSubtask(2, "PENDING")];
    const storeWithSelection = createDashboardStore(undefined, {
      selectedSubtask: { taskFolder: "test-task", subtaskFile: "001-test.md" }
    });

    const { container } = renderWithStore(subtasks, storeWithSelection);
    const html = container.innerHTML;

    const selectedCount = (html.match(/border-width: 3px/g) || []).length;
    expect(selectedCount).toBe(1);

    const unselectedCount = (html.match(/border-width: 2px/g) || []).length;
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

    const { container } = renderWithStore(subtasks, storeWithSelection);
    const html = container.innerHTML;

    expect(html).not.toContain("border-color: #3b82f6");
    expect(html).toContain("border-width: 2px");
  });

  test("container has explicit dimensions for React Flow", () => {
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={[]} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("width:");
    expect(html).toContain("height:");
  });

  test("creates edges container for dependencies", () => {
    const subtasks = [
      makeSubtask(1),
      makeSubtask(2, "PENDING", [1]),
      makeSubtask(3, "PENDING", [1, 2])
    ];
    const { container } = renderWithStore(subtasks);

    expect(container.innerHTML).toContain("react-flow__edges");
  });
});
