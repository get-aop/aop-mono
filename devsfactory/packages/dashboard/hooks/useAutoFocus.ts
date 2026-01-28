import { useEffect } from "react";
import type { StoreApi } from "zustand";
import type { DashboardStore } from "../store";

interface UseAutoFocusOptions {
  store: StoreApi<DashboardStore>;
}

export const useAutoFocus = ({ store }: UseAutoFocusOptions) => {
  useEffect(() => {
    const unsubscribe = store.subscribe((state, prevState) => {
      const { activeAgents, focusedAgent, isPinned } = state;
      const prevActiveAgents = prevState.activeAgents;

      if (isPinned) return;

      // Check for new agents
      for (const agentId of activeAgents.keys()) {
        if (!prevActiveAgents.has(agentId)) {
          store.getState().focusAgent(agentId);
          return;
        }
      }

      if (focusedAgent && !activeAgents.has(focusedAgent)) {
        const agentIds = Array.from(activeAgents.keys());
        const lastAgent = agentIds.at(-1);
        if (lastAgent) {
          store.getState().focusAgent(lastAgent);
        } else {
          store.getState().clearFocus();
        }
      }
    });

    return unsubscribe;
  }, [store]);
};
