import { useDashboardStore } from "../context";
import type { Subtask, SubtaskStatus } from "../types";
import { DebugStream } from "./DebugStream";

export interface SubtaskDetailPanelProps {
  taskFolder: string;
  subtaskFile: string;
  subtask: Subtask;
  logs: string[];
  isLoading: boolean;
  debugMode: boolean;
  hasActiveAgent: boolean;
  onClose: () => void;
}

const SubtaskStatusBadge = ({
  status,
  active
}: { status: SubtaskStatus; active?: boolean }) => {
  const statusClass = `status-${status.toLowerCase().replace("_", "-")}`;
  const pulsingClass = active ? "pulsing" : "";

  return (
    <span className={`status-badge ${statusClass} ${pulsingClass}`.trim()}>
      {status}
    </span>
  );
};

export const SubtaskDetailPanel = ({
  subtask,
  logs,
  isLoading,
  hasActiveAgent,
  onClose
}: SubtaskDetailPanelProps) => {
  const { number, frontmatter, description } = subtask;
  const { title, status, dependencies } = frontmatter;

  return (
    <div className="subtask-detail-panel">
      <div className="subtask-detail-header">
        <button
          type="button"
          className="back-button"
          onClick={onClose}
          aria-label="Back to Activity Feed"
        >
          ← Back
        </button>
        <span className="subtask-title-header">Subtask #{number} Details</span>
      </div>

      <div className="subtask-metadata">
        <div className="metadata-row">
          <span className="metadata-label">Title:</span>
          <span className="metadata-value">{title}</span>
        </div>
        <div className="metadata-row">
          <span className="metadata-label">Status:</span>
          <SubtaskStatusBadge status={status} active={hasActiveAgent} />
          {hasActiveAgent && (
            <span className="agent-active-indicator active">Agent active</span>
          )}
        </div>
        <div className="metadata-row">
          <span className="metadata-label">Dependencies:</span>
          <span className="metadata-value">
            {dependencies.length > 0 ? dependencies.join(", ") : "None"}
          </span>
        </div>
        {description && (
          <div className="metadata-section">
            <span className="metadata-label">Description:</span>
            <p className="metadata-description">{description}</p>
          </div>
        )}
      </div>

      <div className="subtask-logs">
        <div className="logs-header">
          <span>Logs</span>
        </div>
        <div className="logs-content">
          {isLoading ? (
            <div className="logs-loading">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="logs-empty">No logs available for this subtask</div>
          ) : (
            <DebugStream lines={logs} />
          )}
        </div>
      </div>
    </div>
  );
};

export const ConnectedSubtaskDetailPanel = () => {
  const selectedSubtask = useDashboardStore((s) => s.selectedSubtask);
  const subtaskLogs = useDashboardStore((s) => s.subtaskLogs);
  const subtaskLogsLoading = useDashboardStore((s) => s.subtaskLogsLoading);
  const debugMode = useDashboardStore((s) => s.debugMode);
  const clearSubtaskSelection = useDashboardStore(
    (s) => s.clearSubtaskSelection
  );
  const subtasks = useDashboardStore((s) => s.subtasks);
  const activeAgents = useDashboardStore((s) => s.activeAgents);

  if (!selectedSubtask) return null;

  const taskSubtasks = subtasks[selectedSubtask.taskFolder] ?? [];
  const subtask = taskSubtasks.find(
    (s) => s.filename === selectedSubtask.subtaskFile
  );
  if (!subtask) return null;

  const hasActiveAgent = Array.from(activeAgents.values()).some(
    (a) =>
      a.taskFolder === selectedSubtask.taskFolder &&
      a.subtaskFile === selectedSubtask.subtaskFile
  );

  return (
    <SubtaskDetailPanel
      taskFolder={selectedSubtask.taskFolder}
      subtaskFile={selectedSubtask.subtaskFile}
      subtask={subtask}
      logs={subtaskLogs}
      isLoading={subtaskLogsLoading}
      debugMode={debugMode}
      hasActiveAgent={hasActiveAgent}
      onClose={clearSubtaskSelection}
    />
  );
};
