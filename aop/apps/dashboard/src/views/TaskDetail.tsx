import { useCallback, useEffect, useMemo, useState } from "react";
import { markReady, removeTask } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { type LogLine, LogViewer } from "../components/LogViewer";
import { StatusBadge } from "../components/StatusBadge";
import { StepList } from "../components/StepList";
import { useSSE } from "../hooks/useSSE";
import { useTaskEvents } from "../hooks/useTaskEvents";
import type { Execution, Step, Task } from "../types";
import { formatDuration } from "../utils/format";

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
      <div className="flex h-screen flex-col bg-aop-black">
        <Header onClose={onClose} onNavigate={onNavigate} />
        <div className="flex flex-1 items-center justify-center">
          <span className="font-mono text-sm text-aop-slate-dark">Task not found</span>
        </div>
      </div>
    );
  }

  const changeName = task.changePath?.split("/").pop() ?? task.changePath ?? "";

  return (
    <div className="flex h-screen flex-col bg-aop-black" data-testid="task-detail">
      <Header onClose={onClose} onNavigate={onNavigate} />

      <main className="flex flex-1 flex-col overflow-hidden px-6 py-3">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3 overflow-hidden">
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
  const repoName = task.repoPath?.split("/").pop() ?? task.repoPath ?? "";
  const changeName = task.changePath?.split("/").pop() ?? task.changePath ?? "";

  return (
    <div className="rounded-aop border border-aop-charcoal bg-aop-darkest px-5 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-body text-lg text-aop-cream">{changeName}</h1>
          <StatusBadge status={task.status} />
          <span className="font-mono text-[10px] text-aop-slate-dark">{repoName}</span>
        </div>

        <div className="flex items-center gap-2">
          {task.status === "DRAFT" && (
            <button
              type="button"
              onClick={onMarkReady}
              disabled={isMarkingReady}
              data-testid="mark-ready-button"
              className="cursor-pointer rounded-aop bg-aop-amber px-3 py-1 font-mono text-[10px] text-aop-black transition-colors hover:bg-aop-amber/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isMarkingReady ? "Marking..." : "Mark Ready"}
            </button>
          )}
          <button
            type="button"
            onClick={onShowRemoveDialog}
            data-testid="remove-task-button"
            className="cursor-pointer rounded-aop border border-aop-charcoal px-3 py-1 font-mono text-[10px] text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-6 border-t border-aop-charcoal pt-2">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-aop-slate-dark">CREATED</span>
          <span className="font-mono text-[10px] text-aop-slate-light">
            {formatTimestamp(task.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-aop-slate-dark">UPDATED</span>
          <span className="font-mono text-[10px] text-aop-slate-light">
            {formatTimestamp(task.updatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-aop-slate-dark">PATH</span>
          <span className="font-mono text-[10px] text-aop-slate-light">{task.changePath}</span>
        </div>
      </div>

      {task.baseBranch && (
        <div className="mt-4 border-t border-aop-charcoal pt-4">
          <span className="font-mono text-[10px] text-aop-slate-dark">BASE BRANCH</span>
          <div className="mt-1 font-mono text-xs text-aop-slate-light">{task.baseBranch}</div>
        </div>
      )}

      {task.status === "BLOCKED" && task.errorMessage && (
        <div className="mt-4 rounded-aop border border-aop-blocked/50 bg-aop-blocked/[0.08] p-4">
          <span className="font-mono text-[10px] text-aop-blocked">ERROR</span>
          <div className="mt-1 font-mono text-xs text-aop-cream">{task.errorMessage}</div>
        </div>
      )}
    </div>
  );
};

const findRunningStepId = (steps: Step[]): string | null =>
  steps.find((s) => s.status === "running")?.id ?? null;

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
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [prevExpandedId, setPrevExpandedId] = useState<string | null>(null);

  const expandedExecution = useMemo(
    () => executions.find((e) => e.id === expandedExecutionId),
    [executions, expandedExecutionId],
  );

  // Reset step selection when switching executions
  if (expandedExecutionId !== prevExpandedId) {
    setPrevExpandedId(expandedExecutionId);
    const running = expandedExecution ? findRunningStepId(expandedExecution.steps) : null;
    setSelectedStepId(running);
  }

  // Auto-follow running step during live executions
  const runningStepId = expandedExecution ? findRunningStepId(expandedExecution.steps) : null;
  useEffect(() => {
    if (runningStepId) setSelectedStepId(runningStepId);
  }, [runningStepId]);

  const handleStepClick = (stepId: string) => {
    setSelectedStepId((prev) => (prev === stepId ? null : stepId));
  };

  const getStatusLabel = (status: Execution["status"]) =>
    ({ running: "Running", completed: "Completed", failed: "Failed" })[status];

  const getStatusColor = (status: Execution["status"]) =>
    ({ running: "text-aop-working", completed: "text-aop-success", failed: "text-aop-blocked" })[
      status
    ];

  return (
    <div
      className={`flex flex-col ${expandedExecutionId ? "flex-1 overflow-hidden" : "shrink-0"}`}
      data-testid="execution-history"
    >
      <h2 className="shrink-0 font-mono text-[10px] text-aop-slate-dark">EXECUTION HISTORY</h2>

      {executions.length === 0 ? (
        <div className="mt-2 font-mono text-xs text-aop-slate-dark">No executions yet</div>
      ) : (
        <div className="mt-2 flex flex-1 flex-col gap-1.5 overflow-auto">
          {executions.map((execution) => {
            const isExpanded = expandedExecutionId === execution.id;

            return (
              <div
                key={execution.id}
                data-testid={`execution-item-${execution.id}`}
                className={`flex flex-col ${isExpanded ? "flex-1 overflow-hidden" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onToggleExecution(execution.id)}
                  className="flex w-full shrink-0 cursor-pointer items-center justify-between rounded-aop border border-aop-charcoal bg-aop-dark px-3 py-2 text-left transition-colors hover:border-aop-slate-dark"
                >
                  <div className="flex items-center gap-3">
                    <span className={`font-mono text-[10px] ${getStatusColor(execution.status)}`}>
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

                {isExpanded && execution.steps.length > 0 && (
                  <div className="mt-1 flex flex-1 flex-col overflow-hidden border-l border-aop-charcoal pl-3">
                    <StepList
                      steps={execution.steps}
                      logLines={logLines}
                      selectedStepId={selectedStepId}
                      onStepClick={handleStepClick}
                    />
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
  <div className="flex flex-1 flex-col overflow-hidden">
    <div className="mb-1 flex shrink-0 items-center justify-between">
      <h2 className="font-mono text-[10px] text-aop-slate-dark">LIVE LOGS</h2>
      <span
        className={`font-mono text-[10px] ${connected ? "text-aop-success" : "text-aop-slate-dark"}`}
      >
        {connected ? "● Connected" : "○ Connecting..."}
      </span>
    </div>
    <div className="flex-1 min-h-0 overflow-hidden rounded-aop border border-aop-charcoal">
      <LogViewer lines={logLines} />
    </div>
  </div>
);
