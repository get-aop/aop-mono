import { useDashboardStore } from "../context";

export const AgentControl = () => {
  const status = useDashboardStore((s) => s.localAgent.status);
  const error = useDashboardStore((s) => s.localAgent.error);
  const startAgent = useDashboardStore((s) => s.startLocalAgent);
  const stopAgent = useDashboardStore((s) => s.stopLocalAgent);

  const statusClass =
    status === "connected"
      ? "agent-status-connected"
      : status === "connecting"
        ? "agent-status-connecting"
        : "agent-status-disconnected";

  return (
    <div className="agent-control">
      <span className={`agent-status ${statusClass}`}>
        Agent: {status}
        {error && (
          <span className="agent-error" title={error}>
            !
          </span>
        )}
      </span>
      <button
        type="button"
        className="agent-control-btn connect"
        onClick={startAgent}
        disabled={status === "connected" || status === "connecting"}
      >
        Connect
      </button>
      <button
        type="button"
        className="agent-control-btn disconnect"
        onClick={stopAgent}
        disabled={status === "disconnected"}
      >
        Disconnect
      </button>
    </div>
  );
};
