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

  test("renders dag-view class on container", () => {
    const html = renderToString(
      <StoreContext.Provider value={store}>
        <DAGView subtasks={[]} taskFolder="test-task" />
      </StoreContext.Provider>
    );
    expect(html).toContain("dag-view");
  });

  test("renders empty grid for no subtasks", () => {
    const { container } = renderWithStore([]);
    expect(container.querySelector(".dag-view")).not.toBeNull();
  });

  test("renders cards for each subtask", () => {
    const subtasks = [makeSubtask(1), makeSubtask(2)];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain("Subtask 1");
    expect(container.innerHTML).toContain("Subtask 2");
  });

  test("displays subtask number", () => {
    const subtasks = [makeSubtask(1)];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain("1.");
  });

  test("clicking card calls selectSubtask", () => {
    const subtasks = [makeSubtask(1)];
    const { container } = renderWithStore(subtasks);

    const cards = container.querySelectorAll("[style*='cursor: pointer']");
    expect(cards.length).toBeGreaterThan(0);

    fireEvent.click(cards[0]);

    expect(store.getState().selectedSubtask).toEqual({
      taskFolder: "test-task",
      subtaskFile: "001-test.md"
    });
  });

  test("shows Running badge for subtask with active agent", () => {
    const subtasks = [makeSubtask(1, "INPROGRESS")];
    store.getState().updateFromServer({
      type: "agentStarted",
      agentId: "agent-1",
      taskFolder: "test-task",
      subtaskFile: "001-test.md",
      agentType: "implementation"
    });

    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain("Running");
  });

  test("does not show Running badge for subtask without active agent", () => {
    const subtasks = [makeSubtask(1, "INPROGRESS")];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).not.toContain("Running");
  });

  test("selected card has blue border", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const storeWithSelection = createDashboardStore(undefined, {
      selectedSubtask: { taskFolder: "test-task", subtaskFile: "001-test.md" }
    });

    const { container } = renderWithStore(subtasks, storeWithSelection);
    expect(container.innerHTML).toContain("2px solid #3b82f6");
  });

  test("unselected card has gray border", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain("1px solid #374151");
  });

  test("displays dependencies when present", () => {
    const subtasks = [makeSubtask(1, "PENDING", [2, 3])];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).toContain("Deps:");
    expect(container.innerHTML).toContain("2, 3");
  });

  test("does not show Deps label when no dependencies", () => {
    const subtasks = [makeSubtask(1, "PENDING", [])];
    const { container } = renderWithStore(subtasks);
    expect(container.innerHTML).not.toContain("Deps:");
  });

  test("no cards selected when taskFolder does not match", () => {
    const subtasks = [makeSubtask(1, "PENDING")];
    const storeWithSelection = createDashboardStore(undefined, {
      selectedSubtask: {
        taskFolder: "different-task",
        subtaskFile: "001-test.md"
      }
    });

    const { container } = renderWithStore(subtasks, storeWithSelection);
    const html = container.innerHTML;

    expect(html).not.toContain("2px solid #3b82f6");
    expect(html).toContain("1px solid #374151");
  });

  test("renders status color indicator", () => {
    const subtasks = [
      makeSubtask(1, "PENDING"),
      makeSubtask(2, "INPROGRESS"),
      makeSubtask(3, "DONE")
    ];
    const { container } = renderWithStore(subtasks);
    const html = container.innerHTML;

    // Status colors
    expect(html).toContain("#fbbf24"); // PENDING - yellow
    expect(html).toContain("#3b82f6"); // INPROGRESS - blue
    expect(html).toContain("#22c55e"); // DONE - green
  });

  test("uses grid layout for cards", () => {
    const { container } = renderWithStore([makeSubtask(1)]);
    expect(container.innerHTML).toContain("display: grid");
    expect(container.innerHTML).toContain("grid-template-columns");
  });
});
