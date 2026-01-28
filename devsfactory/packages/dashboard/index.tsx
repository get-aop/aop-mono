import { createRoot } from "react-dom/client";
import { createApiClient } from "./api";
import { App } from "./components/App";
import { StoreContext } from "./context";
import { createDashboardStore } from "./store";
import "./index.css";

// Connect to dev server on port 3001
const apiClient = createApiClient("http://localhost:3001");
const store = createDashboardStore(apiClient);

const root = createRoot(document.getElementById("root")!);
root.render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>
);
