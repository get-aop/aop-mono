import { createContext, useContext } from "react";
import { type StoreApi, useStore } from "zustand";
import type { DashboardStore } from "./store";

export const StoreContext = createContext<StoreApi<DashboardStore> | null>(
  null
);

export const useDashboardStore = <T>(
  selector: (state: DashboardStore) => T
): T => {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error(
      "useDashboardStore must be used within StoreContext.Provider"
    );
  }
  return useStore(store, selector);
};
