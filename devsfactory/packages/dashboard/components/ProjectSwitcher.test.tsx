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
import { StoreContext } from "../context";
import { createDashboardStore } from "../store";
import { ProjectSwitcher } from "./ProjectSwitcher";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("ProjectSwitcher", () => {
  let store: ReturnType<typeof createDashboardStore>;

  const renderWithStore = (storeInstance = store) => {
    return render(
      <StoreContext.Provider value={storeInstance}>
        <ProjectSwitcher />
      </StoreContext.Provider>
    );
  };

  beforeEach(() => {
    store = createDashboardStore();
  });

  test("renders nothing when not in global mode", () => {
    const { container } = renderWithStore();
    expect(container.querySelector(".project-switcher")).toBeNull();
  });

  test("renders project switcher when in global mode", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [],
        isGlobalMode: true,
        currentProject: null,
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    expect(container.querySelector(".project-switcher")).not.toBeNull();
  });

  test("shows 'All Projects' when no project is selected", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "project-1", path: "/path/1", registered: new Date(), taskCount: 3 }
        ],
        isGlobalMode: true,
        currentProject: null,
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    expect(container.textContent).toContain("All Projects");
  });

  test("shows current project name when selected", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "my-project", path: "/path/1", registered: new Date(), taskCount: 5 }
        ],
        isGlobalMode: true,
        currentProject: "my-project",
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    const button = container.querySelector(".project-switcher-current");
    expect(button?.textContent).toContain("my-project");
  });

  test("shows task count badge for current project", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "my-project", path: "/path/1", registered: new Date(), taskCount: 7 }
        ],
        isGlobalMode: true,
        currentProject: "my-project",
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    const badge = container.querySelector(".task-count-badge");
    expect(badge?.textContent).toBe("7");
  });

  test("opens dropdown on click", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "project-1", path: "/path/1", registered: new Date(), taskCount: 3 }
        ],
        isGlobalMode: true,
        currentProject: null,
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    const button = container.querySelector(".project-switcher-current")!;

    expect(container.querySelector(".project-switcher-dropdown")).toBeNull();
    fireEvent.click(button);
    expect(container.querySelector(".project-switcher-dropdown")).not.toBeNull();
  });

  test("lists all projects in dropdown", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "project-a", path: "/path/a", registered: new Date(), taskCount: 2 },
          { name: "project-b", path: "/path/b", registered: new Date(), taskCount: 4 }
        ],
        isGlobalMode: true,
        currentProject: null,
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    const button = container.querySelector(".project-switcher-current")!;
    fireEvent.click(button);

    const dropdown = container.querySelector(".project-switcher-dropdown")!;
    expect(dropdown.textContent).toContain("All Projects");
    expect(dropdown.textContent).toContain("project-a");
    expect(dropdown.textContent).toContain("project-b");
  });

  test("selects project when clicking on dropdown item", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "project-x", path: "/path/x", registered: new Date(), taskCount: 1 }
        ],
        isGlobalMode: true,
        currentProject: null,
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    const button = container.querySelector(".project-switcher-current")!;
    fireEvent.click(button);

    const items = container.querySelectorAll(".project-switcher-item");
    const projectItem = items[1]!;
    fireEvent.click(projectItem);

    expect(store.getState().project.currentProject).toBe("project-x");
  });

  test("selects all projects when clicking 'All Projects' option", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "project-y", path: "/path/y", registered: new Date(), taskCount: 2 }
        ],
        isGlobalMode: true,
        currentProject: "project-y",
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    const button = container.querySelector(".project-switcher-current")!;
    fireEvent.click(button);

    const items = container.querySelectorAll(".project-switcher-item");
    const allProjectsItem = items[0]!;
    fireEvent.click(allProjectsItem);

    expect(store.getState().project.currentProject).toBeNull();
  });

  test("closes dropdown after selection", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "project-z", path: "/path/z", registered: new Date(), taskCount: 3 }
        ],
        isGlobalMode: true,
        currentProject: null,
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    const button = container.querySelector(".project-switcher-current")!;
    fireEvent.click(button);

    expect(container.querySelector(".project-switcher-dropdown")).not.toBeNull();

    const items = container.querySelectorAll(".project-switcher-item");
    fireEvent.click(items[1]!);

    expect(container.querySelector(".project-switcher-dropdown")).toBeNull();
  });

  test("shows selected state for current project in dropdown", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "selected-proj", path: "/path/s", registered: new Date(), taskCount: 5 }
        ],
        isGlobalMode: true,
        currentProject: "selected-proj",
        projectsLoading: false,
        projectsError: null
      }
    });
    const { container } = renderWithStore(store);
    const button = container.querySelector(".project-switcher-current")!;
    fireEvent.click(button);

    const items = container.querySelectorAll(".project-switcher-item");
    const selectedItem = items[1]!;
    expect(selectedItem.className).toContain("selected");
  });
});
