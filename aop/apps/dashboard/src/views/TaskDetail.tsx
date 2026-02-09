import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, applyTask, blockTask, markReady, removeTask } from "../api/client";
import { ApplyDialog } from "../components/ApplyDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { type LogLine, LogViewer } from "../components/LogViewer";
import { MarkReadyDialog } from "../components/MarkReadyDialog";
import { SpecsTab } from "../components/SpecsTab";
import { StatusBadge } from "../components/StatusBadge";
import { StepList } from "../components/StepList";
import { TaskProgress } from "../components/TaskProgress";
import { useSSE } from "../hooks/useSSE";
import { useTaskEvents } from "../hooks/useTaskEvents";
import type { Execution, Step, Task } from "../types";
import { formatDuration } from "../utils/format";
import { type DetailTab, TabSwitcher } from "./TabSwitcher";

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

const useTaskLogs = (activeExecutionId: string | null) => {
  const [logLines, setLogLines] = useState<LogLine[]>([]);

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

  const { connected } = useSSE<LogEvent>({
    url: activeExecutionId ? `/api/executions/${activeExecutionId}/logs` : null,
    eventTypes: ["message"],
    onMessage: handleLogMessage,
  });

  useEffect(() => {
    if (activeExecutionId) setLogLines([]);
  }, [activeExecutionId]);

  return { logLines, connected };
};

const useDialogs = (task: Task | undefined, onClose: () => void) => {
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showMarkReadyDialog, setShowMarkReadyDialog] = useState(false);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"error" | "success">("error");

  const showToast = (message: string, type: "error" | "success" = "error") => {
    setToastType(type);
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleMarkReadyConfirm = async (workflow: string, baseBranch: string, provider: string) => {
    if (!task) return;
    try {
      await markReady(task.repoId, task.id, workflow, baseBranch || undefined, provider);
      setShowMarkReadyDialog(false);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to mark task as ready");
      setShowMarkReadyDialog(false);
    }
  };

  const handleApplyConfirm = async (targetBranch?: string) => {
    if (!task) return;
    try {
      const result = await applyTask(task.repoId, task.id, targetBranch);
      if (result.noChanges) {
        showToast("No changes to apply", "success");
      } else if (result.conflictingFiles.length > 0) {
        showToast(
          `Applied ${result.affectedFiles.length} file(s) with ${result.conflictingFiles.length} conflict(s) — resolve manually`,
          "success",
        );
      } else {
        showToast(`Applied ${result.affectedFiles.length} file(s) successfully`, "success");
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to apply changes");
    }
    setShowApplyDialog(false);
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

  const handleBlock = async () => {
    if (!task) return;
    setIsBlocking(true);
    try {
      await blockTask(task.repoId, task.id);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to block task");
    } finally {
      setIsBlocking(false);
      setShowBlockDialog(false);
    }
  };

  return {
    showRemoveDialog,
    setShowRemoveDialog,
    showMarkReadyDialog,
    setShowMarkReadyDialog,
    showApplyDialog,
    setShowApplyDialog,
    showBlockDialog,
    setShowBlockDialog,
    isRemoving,
    isBlocking,
    toastMessage,
    toastType,
    handleMarkReadyConfirm,
    handleApplyConfirm,
    handleRemove,
    handleBlock,
  };
};

const TaskDetailDialogs = ({
  task,
  dialogs,
}: {
  task: Task;
  dialogs: ReturnType<typeof useDialogs>;
}) => {
  const changeName = task.changePath?.split("/").pop() ?? task.changePath ?? "";

  return (
    <>
      <MarkReadyDialog
        open={dialogs.showMarkReadyDialog}
        repoId={task.repoId}
        onConfirm={dialogs.handleMarkReadyConfirm}
        onCancel={() => dialogs.setShowMarkReadyDialog(false)}
      />

      <ApplyDialog
        open={dialogs.showApplyDialog}
        repoId={task.repoId}
        defaultBranch={task.baseBranch}
        onConfirm={dialogs.handleApplyConfirm}
        onCancel={() => dialogs.setShowApplyDialog(false)}
      />

      <ConfirmDialog
        open={dialogs.showRemoveDialog}
        title="Remove Task"
        message={`Are you sure you want to remove "${changeName}"?${task.status === "WORKING" ? " This will abort the running execution." : ""}`}
        confirmLabel={dialogs.isRemoving ? "Removing..." : "Remove"}
        destructive
        onConfirm={dialogs.handleRemove}
        onCancel={() => dialogs.setShowRemoveDialog(false)}
      />

      <ConfirmDialog
        open={dialogs.showBlockDialog}
        title="Block Task"
        message={`Are you sure you want to block "${changeName}"? This will stop all running agents. You can resume the task later with "Mark Ready".`}
        confirmLabel={dialogs.isBlocking ? "Blocking..." : "Block"}
        destructive
        onConfirm={dialogs.handleBlock}
        onCancel={() => dialogs.setShowBlockDialog(false)}
      />

      {dialogs.toastMessage && (
        <div
          className={`fixed bottom-4 right-4 rounded-aop-lg px-4 py-3 font-mono text-xs ${
            dialogs.toastType === "success"
              ? "bg-aop-success/20 text-aop-success"
              : "bg-aop-blocked/20 text-aop-blocked"
          }`}
        >
          {dialogs.toastMessage}
        </div>
      )}
    </>
  );
};

export const TaskDetail = ({ taskId, onClose, onNavigate }: TaskDetailProps) => {
  const { tasks } = useTaskEvents();
  const task = tasks.find((t) => t.id === taskId);

  const [executions, setExecutions] = useState<Execution[]>([]);
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null);

  const defaultTab: DetailTab = task?.status === "WORKING" ? "logs" : "specs";
  const [activeTab, setActiveTab] = useState<DetailTab>(defaultTab);

  const activeExecutionId =
    task?.status === "WORKING" ? task.currentExecutionId : expandedExecutionId;

  const { logLines, connected: logsConnected } = useTaskLogs(activeExecutionId ?? null);
  const dialogs = useDialogs(task, onClose);

  useEffect(() => {
    if (!task) return;
    fetch(`/api/repos/${task.repoId}/tasks/${task.id}/executions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setExecutions(data.executions ?? []))
      .catch(() => {});
  }, [task]);

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

  return (
    <div className="flex h-screen flex-col bg-aop-black" data-testid="task-detail">
      <Header onClose={onClose} onNavigate={onNavigate} />

      <main className="flex flex-1 flex-col overflow-hidden px-6 py-3">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3 min-h-0">
          <TaskInfoCard
            task={task}
            onMarkReady={() => dialogs.setShowMarkReadyDialog(true)}
            onApply={() => dialogs.setShowApplyDialog(true)}
            onShowBlockDialog={() => dialogs.setShowBlockDialog(true)}
            onShowRemoveDialog={() => dialogs.setShowRemoveDialog(true)}
          />

          <TabSwitcher
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isWorking={task.status === "WORKING"}
          />

          {activeTab === "logs" && (
            <LogsContent
              task={task}
              executions={executions}
              expandedExecutionId={expandedExecutionId}
              logLines={logLines}
              logsConnected={logsConnected}
              onToggleExecution={(id) =>
                setExpandedExecutionId((prev) => (prev === id ? null : id))
              }
            />
          )}

          {activeTab === "specs" && <SpecsTab task={task} />}
        </div>
      </main>

      <TaskDetailDialogs task={task} dialogs={dialogs} />
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

const BranchIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="currentColor"
    className="shrink-0"
    role="img"
    aria-label="Branch"
  >
    <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
  </svg>
);

const BranchBadge = ({ branch }: { branch: string }) => (
  <div className="flex items-center gap-1 rounded-full border border-aop-charcoal bg-aop-dark px-2 py-0.5 text-aop-slate-light">
    <BranchIcon />
    <span className="font-mono text-[10px]">{branch}</span>
  </div>
);

const ProviderIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="currentColor"
    className="shrink-0"
    role="img"
    aria-label="Provider"
  >
    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 2a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 4.5Zm0 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
  </svg>
);

const formatProviderLabel = (provider: string): string => {
  if (provider === "claude-code") return "Opus 4.6";
  if (provider === "opencode:opencode/kimi-k2.5-free") return "Kimi 2.5";
  if (provider === "opencode:openai/gpt-5.3-codex") return "GPT 5.3 Codex";
  return provider;
};

const ProviderBadge = ({ provider }: { provider: string }) => (
  <div className="flex items-center gap-1 rounded-full border border-aop-charcoal bg-aop-dark px-2 py-0.5 text-aop-slate-light">
    <ProviderIcon />
    <span className="font-mono text-[10px]">{formatProviderLabel(provider)}</span>
  </div>
);

interface TaskInfoCardProps {
  task: Task;
  onMarkReady: () => void;
  onApply: () => void;
  onShowBlockDialog: () => void;
  onShowRemoveDialog: () => void;
}

const TaskActions = ({
  status,
  onMarkReady,
  onApply,
  onShowBlockDialog,
  onShowRemoveDialog,
}: {
  status: string;
  onMarkReady: () => void;
  onApply: () => void;
  onShowBlockDialog: () => void;
  onShowRemoveDialog: () => void;
}) => (
  <div className="flex items-center gap-2">
    {(status === "DRAFT" || status === "BLOCKED") && (
      <button
        type="button"
        onClick={onMarkReady}
        data-testid="mark-ready-button"
        className="cursor-pointer rounded-aop bg-aop-amber px-3 py-1 font-mono text-[10px] text-aop-black transition-colors hover:bg-aop-amber/90"
      >
        Mark Ready
      </button>
    )}
    {(status === "DONE" || status === "BLOCKED") && (
      <button
        type="button"
        onClick={onApply}
        data-testid="apply-button"
        className="cursor-pointer rounded-aop bg-aop-amber px-3 py-1 font-mono text-[10px] text-aop-black transition-colors hover:bg-aop-amber/90"
      >
        Apply
      </button>
    )}
    {status === "WORKING" && (
      <button
        type="button"
        onClick={onShowBlockDialog}
        data-testid="block-task-button"
        className="cursor-pointer rounded-aop border border-aop-blocked/50 px-3 py-1 font-mono text-[10px] text-aop-blocked transition-colors hover:border-aop-blocked hover:bg-aop-blocked/10"
      >
        Block
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
);

const TaskInfoCard = ({
  task,
  onMarkReady,
  onApply,
  onShowBlockDialog,
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
          {task.taskProgress && (
            <TaskProgress completed={task.taskProgress.completed} total={task.taskProgress.total} />
          )}
          <span className="font-mono text-[10px] text-aop-slate-dark">{repoName}</span>
        </div>

        <TaskActions
          status={task.status}
          onMarkReady={onMarkReady}
          onApply={onApply}
          onShowBlockDialog={onShowBlockDialog}
          onShowRemoveDialog={onShowRemoveDialog}
        />
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
        {task.baseBranch && <BranchBadge branch={task.baseBranch} />}
        {task.preferredProvider && <ProviderBadge provider={task.preferredProvider} />}
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

const LogsContent = ({
  task,
  executions,
  expandedExecutionId,
  logLines,
  logsConnected,
  onToggleExecution,
}: {
  task: Task;
  executions: Execution[];
  expandedExecutionId: string | null;
  logLines: LogLine[];
  logsConnected: boolean;
  onToggleExecution: (id: string) => void;
}) => (
  <>
    <ExecutionHistory
      executions={executions}
      expandedExecutionId={expandedExecutionId}
      logLines={logLines}
      onToggleExecution={onToggleExecution}
    />

    {task.status === "WORKING" && task.currentExecutionId && (
      <LiveLogs logLines={logLines} connected={logsConnected} />
    )}
  </>
);

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
