import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook } from "@testing-library/react";
import { createDashboardStore } from "../store";
import { useProjectRoute } from "./useProjectRoute";

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe("useProjectRoute", () => {
  let store: ReturnType<typeof createDashboardStore>;
  let originalPushState: typeof window.history.pushState;
  let mockPushState: ReturnType<typeof mock>;

  beforeEach(() => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [
          { name: "project-1", path: "/path/1", registered: new Date(), taskCount: 3 },
          { name: "project-2", path: "/path/2", registered: new Date(), taskCount: 5 }
        ],
        isGlobalMode: true,
        currentProject: null,
        projectsLoading: false,
        projectsError: null
      }
    });

    originalPushState = window.history.pushState;
    mockPushState = mock(() => {});
    window.history.pushState = mockPushState as unknown as typeof window.history.pushState;

    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true
    });
  });

  afterEach(() => {
    window.history.pushState = originalPushState;
  });

  test("syncs project from URL path on mount", () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/project/project-1" },
      writable: true
    });

    renderHook(() => useProjectRoute({ store }));

    expect(store.getState().project.currentProject).toBe("project-1");
  });

  test("handles encoded project names in URL", () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/project/my%20project" },
      writable: true
    });

    renderHook(() => useProjectRoute({ store }));

    expect(store.getState().project.currentProject).toBe("my project");
  });

  test("sets null project for root path", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [],
        isGlobalMode: true,
        currentProject: "project-1",
        projectsLoading: false,
        projectsError: null
      }
    });

    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true
    });

    renderHook(() => useProjectRoute({ store }));

    expect(store.getState().project.currentProject).toBeNull();
  });

  test("updates URL when project changes in store", () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true
    });

    renderHook(() => useProjectRoute({ store }));

    store.getState().selectProject("project-2");

    expect(mockPushState).toHaveBeenCalled();
    const lastCall = mockPushState.mock.calls[mockPushState.mock.calls.length - 1];
    expect(lastCall[2]).toBe("/project/project-2");
  });

  test("updates URL to root when selecting all projects", () => {
    store = createDashboardStore(undefined, {
      project: {
        projects: [],
        isGlobalMode: true,
        currentProject: "project-1",
        projectsLoading: false,
        projectsError: null
      }
    });

    Object.defineProperty(window, "location", {
      value: { pathname: "/project/project-1" },
      writable: true
    });

    renderHook(() => useProjectRoute({ store }));

    store.getState().selectAllProjects();

    expect(mockPushState).toHaveBeenCalled();
    const lastCall = mockPushState.mock.calls[mockPushState.mock.calls.length - 1];
    expect(lastCall[2]).toBe("/");
  });
});
