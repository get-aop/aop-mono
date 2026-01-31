import { useCallback, useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { DashboardStore } from "../store";

export interface UseProjectRouteOptions {
  store: StoreApi<DashboardStore>;
}

export const useProjectRoute = ({ store }: UseProjectRouteOptions) => {
  const syncFromUrl = useCallback(() => {
    const path = window.location.pathname;
    const projectMatch = path.match(/^\/project\/([^/]+)/);

    if (projectMatch) {
      const projectName = decodeURIComponent(projectMatch[1]);
      const state = store.getState();
      if (state.project.currentProject !== projectName) {
        state.selectProject(projectName);
      }
    } else if (path === "/" || path === "") {
      const state = store.getState();
      if (state.project.currentProject !== null) {
        state.selectAllProjects();
      }
    }
  }, [store]);

  const updateUrl = useCallback(
    (projectName: string | null) => {
      const newPath = projectName
        ? `/project/${encodeURIComponent(projectName)}`
        : "/";

      if (window.location.pathname !== newPath) {
        window.history.pushState({}, "", newPath);
      }
    },
    []
  );

  useEffect(() => {
    syncFromUrl();

    const handlePopState = () => {
      syncFromUrl();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [syncFromUrl]);

  useEffect(() => {
    const unsubscribe = store.subscribe((state, prevState) => {
      if (state.project.currentProject !== prevState.project.currentProject) {
        updateUrl(state.project.currentProject);
      }
    });

    return unsubscribe;
  }, [store, updateUrl]);
};
