import { createRoot } from "react-dom/client";
import { createApiClient } from "./api";
import { App } from "./components/App";
import { StoreContext } from "./context";
import { createDashboardStore } from "./store";
import "./index.css";

// Use same origin (empty string) when served by dashboard server
const apiClient = createApiClient("");
const store = createDashboardStore(apiClient);

const root = createRoot(document.getElementById("root")!);
root.render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>
);
