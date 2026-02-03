import { useContext, useEffect } from "react";
import { StoreContext, useDashboardStore } from "../context";
import { useProjectRoute } from "../hooks/useProjectRoute";
import { useWebSocket } from "../hooks/useWebSocket";
import { Header } from "./Header";
import { Layout } from "./Layout";

const getWsUrl = () => {
  if (typeof window === "undefined") {
    return "ws://localhost:3001/api/events";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/events`;
};

const AppContent = () => {
  const store = useContext(StoreContext);
  const loadProjects = useDashboardStore((s) => s.loadProjects);

  useWebSocket({ store: store!, url: getWsUrl() });
  useProjectRoute({ store: store! });

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className="app">
      <Header />
      <Layout />
    </div>
  );
};

export const App = () => <AppContent />;
