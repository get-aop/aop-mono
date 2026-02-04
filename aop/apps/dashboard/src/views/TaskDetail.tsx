import { useCallback, useEffect, useState } from "react";
import { markReady, removeTask } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { type LogLine, LogViewer } from "../components/LogViewer";
import { StatusBadge } from "../components/StatusBadge";
import { StepList } from "../components/StepList";
import { useSSE } from "../hooks/useSSE";
import { useTaskEvents } from "../hooks/useTaskEvents";
import type { Execution, Task } from "../types";

interface TaskDetailProps {
  taskId: string;
  onClose: () => void;
  onNavigate?: (path: string) => void;
}

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

const formatDuration = (startedAt: string, finishedAt?: string): string => {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;

  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

interface LogEvent {
  type: "log" | "replay";
  stream?: "stdout" | "stderr";
  content?: string;
  timestamp?: string;
  lines?: { stream: string; content: string; timestamp: string }[];
}

export const TaskDetail = ({ taskId, onClose, onNavigate }: TaskDetailProps) => {
  const { tasks } = useTaskEvents();
  const task = tasks.find((t) => t.id === taskId);

  const [executions, setExecutions] = useState<Execution[]>([]);
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isMarkingReady, setIsMarkingReady] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);

  const activeExecutionId =
    task?.status === "WORKING" ? task.currentExecutionId : expandedExecutionId;

  const handleLogMessage = useCallback((_eventType: string, data: LogEvent) => {
    if (data.type === "log") {
      const { stream, content, timestamp } = data;
      if (stream && content && timestamp) {
        setLogLines((prev) => [...prev, { type: stream, content, timestamp }]);
      }
    } else if (data.type === "replay" && data.lines) {
      setLogLines(
        data.lines.map((line) => ({
          type: line.stream as "stdout" | "stderr",
          content: line.content,
          timestamp: line.timestamp,
        })),
      );
    }
  }, []);

  const { connected: logsConnected } = useSSE<LogEvent>({
    url: activeExecutionId ? `/api/executions/${activeExecutionId}/logs` : null,
    eventTypes: ["message"],
    onMessage: handleLogMessage,
  });

  useEffect(() => {
    if (activeExecutionId) setLogLines([]);
  }, [activeExecutionId]);

  useEffect(() => {
    if (!task) return;
    fetch(`/api/repos/${task.repoId}/tasks/${task.id}/executions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setExecutions(data.executions ?? []))
      .catch(() => {});
  }, [task]);

  const handleMarkReady = async () => {
    if (!task) return;
    setIsMarkingReady(true);
    try {
      await markReady(task.repoId, task.id);
    } finally {
      setIsMarkingReady(false);
    }
  };

  const handleRemove = async () => {
    if (!task) return;
    setIsRemoving(true);
    try {
      await removeTask(task.repoId, task.id, task.status === "WORKING");
      onClose();
    } finally {
      setIsRemoving(false);
      setShowRemoveDialog(false);
    }
  };

  if (!task) {
    return (
      <div className="flex min-h-screen flex-col bg-aop-black">
        <Header onClose={onClose} onNavigate={onNavigate} />
        <div className="flex flex-1 items-center justify-center">
          <span className="font-mono text-sm text-aop-slate-dark">Task not found</span>
        </div>
      </div>
    );
  }

  const changeName = task.changePath.split("/").pop() ?? task.changePath;

  return (
    <div className="flex min-h-screen flex-col bg-aop-black" data-testid="task-detail">
      <Header onClose={onClose} onNavigate={onNavigate} />

      <main className="flex flex-1 flex-col p-6">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6">
          <TaskInfoCard
            task={task}
            isMarkingReady={isMarkingReady}
            onMarkReady={handleMarkReady}
            onShowRemoveDialog={() => setShowRemoveDialog(true)}
          />

          <ExecutionHistory
            executions={executions}
            expandedExecutionId={expandedExecutionId}
            logLines={logLines}
            onToggleExecution={(id) => setExpandedExecutionId((prev) => (prev === id ? null : id))}
          />

          {task.status === "WORKING" && task.currentExecutionId && (
            <LiveLogs logLines={logLines} connected={logsConnected} />
          )}
        </div>
      </main>

      <ConfirmDialog
        open={showRemoveDialog}
        title="Remove Task"
        message={`Are you sure you want to remove "${changeName}"?${task.status === "WORKING" ? " This will abort the running execution." : ""}`}
        confirmLabel={isRemoving ? "Removing..." : "Remove"}
        destructive
        onConfirm={handleRemove}
        onCancel={() => setShowRemoveDialog(false)}
      />
    </div>
  );
};

interface HeaderProps {
  onClose: () => void;
  onNavigate?: (path: string) => void;
}

const Header = ({ onClose, onNavigate }: HeaderProps) => (
  <header className="flex h-14 shrink-0 items-center justify-between border-b border-aop-charcoal bg-aop-dark px-6">
    <button
      type="button"
      onClick={() => onNavigate?.("/")}
      className="flex cursor-pointer items-center gap-2 font-mono text-xs text-aop-slate transition-colors hover:text-aop-cream"
    >
      ← Back to Board
    </button>
    <button
      type="button"
      onClick={onClose}
      className="cursor-pointer font-mono text-xs text-aop-slate-dark transition-colors hover:text-aop-cream"
    >
      ESC
    </button>
  </header>
);

interface TaskInfoCardProps {
  task: Task;
  isMarkingReady: boolean;
  onMarkReady: () => void;
  onShowRemoveDialog: () => void;
}

const TaskInfoCard = ({
  task,
  isMarkingReady,
  onMarkReady,
  onShowRemoveDialog,
}: TaskInfoCardProps) => {
  const repoName = task.repoPath.split("/").pop() ?? task.repoPath;
  const changeName = task.changePath.split("/").pop() ?? task.changePath;

  return (
    <div className="rounded-aop border border-aop-charcoal bg-aop-darkest p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h1 className="font-body text-xl text-aop-cream">{changeName}</h1>
          <div className="mt-2 flex items-center gap-4">
            <StatusBadge status={task.status} />
            <span className="font-mono text-xs text-aop-slate-dark">{repoName}</span>
          </div>
        </div>

        <div className="flex gap-2">
          {task.status === "DRAFT" && (
            <button
              type="button"
              onClick={onMarkReady}
              disabled={isMarkingReady}
              data-testid="mark-ready-button"
              className="cursor-pointer rounded-aop bg-aop-amber px-4 py-2 font-mono text-xs text-aop-black transition-colors hover:bg-aop-amber/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isMarkingReady ? "Marking..." : "Mark Ready"}
            </button>
          )}
          <button
            type="button"
            onClick={onShowRemoveDialog}
            data-testid="remove-task-button"
            className="cursor-pointer rounded-aop border border-aop-charcoal px-4 py-2 font-mono text-xs text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-aop-charcoal pt-4">
        <div>
          <span className="font-mono text-[10px] text-aop-slate-dark">CREATED</span>
          <div className="mt-1 font-mono text-xs text-aop-slate-light">
            {formatTimestamp(task.createdAt)}
          </div>
        </div>
        <div>
          <span className="font-mono text-[10px] text-aop-slate-dark">UPDATED</span>
          <div className="mt-1 font-mono text-xs text-aop-slate-light">
            {formatTimestamp(task.updatedAt)}
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-aop-charcoal pt-4">
        <span className="font-mono text-[10px] text-aop-slate-dark">CHANGE PATH</span>
        <div className="mt-1 font-mono text-xs text-aop-slate-light">{task.changePath}</div>
      </div>

      {task.status === "BLOCKED" && task.errorMessage && (
        <div className="mt-4 rounded-aop border border-aop-blocked/50 bg-aop-blocked/[0.08] p-4">
          <span className="font-mono text-[10px] text-aop-blocked">ERROR</span>
          <div className="mt-1 font-mono text-xs text-aop-cream">{task.errorMessage}</div>
        </div>
      )}
    </div>
  );
};

interface ExecutionHistoryProps {
  executions: Execution[];
  expandedExecutionId: string | null;
  logLines: LogLine[];
  onToggleExecution: (id: string) => void;
}

const ExecutionHistory = ({
  executions,
  expandedExecutionId,
  logLines,
  onToggleExecution,
}: ExecutionHistoryProps) => {
  const getStatusLabel = (status: Execution["status"]) =>
    ({ running: "Running", completed: "Completed", failed: "Failed" })[status];

  const getStatusColor = (status: Execution["status"]) =>
    ({ running: "text-aop-working", completed: "text-aop-success", failed: "text-aop-blocked" })[
      status
    ];

  return (
    <div
      className="rounded-aop border border-aop-charcoal bg-aop-darkest p-6"
      data-testid="execution-history"
    >
      <h2 className="font-mono text-xs text-aop-slate-dark">EXECUTION HISTORY</h2>

      {executions.length === 0 ? (
        <div className="mt-4 font-mono text-xs text-aop-slate-dark">No executions yet</div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {executions.map((execution) => {
            const isExpanded = expandedExecutionId === execution.id;

            return (
              <div key={execution.id} data-testid={`execution-item-${execution.id}`}>
                <button
                  type="button"
                  onClick={() => onToggleExecution(execution.id)}
                  className="flex w-full cursor-pointer items-center justify-between rounded-aop border border-aop-charcoal bg-aop-dark p-3 text-left transition-colors hover:border-aop-slate-dark"
                >
                  <div className="flex items-center gap-3">
                    <span className={`font-mono text-xs ${getStatusColor(execution.status)}`}>
                      {getStatusLabel(execution.status)}
                    </span>
                    <span className="font-mono text-[10px] text-aop-slate-dark">
                      {formatTimestamp(execution.startedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-aop-slate-light">
                      {formatDuration(execution.startedAt, execution.finishedAt)}
                    </span>
                    <span className="font-mono text-[10px] text-aop-slate-dark">
                      {isExpanded ? "▼" : "▶"}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="mt-2 flex flex-col gap-2">
                    {execution.steps.length > 0 && (
                      <div className="rounded-aop border border-aop-charcoal bg-aop-dark">
                        <StepList steps={execution.steps} />
                      </div>
                    )}
                    <div className="h-64 rounded-aop border border-aop-charcoal bg-aop-black">
                      <LogViewer lines={logLines} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface LiveLogsProps {
  logLines: LogLine[];
  connected: boolean;
}

const LiveLogs = ({ logLines, connected }: LiveLogsProps) => (
  <div className="flex flex-1 flex-col rounded-aop border border-aop-charcoal bg-aop-darkest p-6">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-mono text-xs text-aop-slate-dark">LIVE LOGS</h2>
      <span
        className={`font-mono text-[10px] ${connected ? "text-aop-success" : "text-aop-slate-dark"}`}
      >
        {connected ? "● Connected" : "○ Connecting..."}
      </span>
    </div>
    <div className="flex-1 overflow-hidden rounded-aop border border-aop-charcoal">
      <LogViewer lines={logLines} />
    </div>
  </div>
);
