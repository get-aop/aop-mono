import { useDashboardStore } from "../context";
import { NewTaskButton } from "./NewTaskButton";

export const Header = () => {
  const connected = useDashboardStore((s) => s.connected);
  const debugMode = useDashboardStore((s) => s.debugMode);
  const toggleDebugMode = useDashboardStore((s) => s.toggleDebugMode);

  const connectionStatus = connected ? "connected" : "disconnected";

  return (
    <header className="header">
      <h1 className="header-title">Devsfactory</h1>
      <div className="header-controls">
        <NewTaskButton />
        <span className={`connection-status ${connectionStatus}`}>
          {connectionStatus}
        </span>
        <button
          type="button"
          className={`debug-toggle ${debugMode ? "active" : ""}`}
          onClick={toggleDebugMode}
        >
          debug
        </button>
      </div>
    </header>
  );
};
