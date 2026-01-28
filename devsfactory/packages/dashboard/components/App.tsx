import { useContext } from "react";
import { StoreContext } from "../context";
import { useWebSocket } from "../hooks/useWebSocket";
import { Header } from "./Header";
import { Layout } from "./Layout";

const WS_URL = "ws://localhost:3001/api/events";

const AppContent = () => {
  const store = useContext(StoreContext);
  useWebSocket({ store: store!, url: WS_URL });

  return (
    <div className="app">
      <Header />
      <Layout />
    </div>
  );
};

export const App = () => <AppContent />;
