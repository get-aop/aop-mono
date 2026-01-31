import { useDashboardStore } from "../context";
import { NewTaskButton } from "./NewTaskButton";
import { ProjectSwitcher } from "./ProjectSwitcher";

export const Header = () => {
  const connected = useDashboardStore((s) => s.connected);
  const debugMode = useDashboardStore((s) => s.debugMode);
  const toggleDebugMode = useDashboardStore((s) => s.toggleDebugMode);

  const connectionStatus = connected ? "connected" : "disconnected";

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">Devsfactory</h1>
        <ProjectSwitcher />
      </div>
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
