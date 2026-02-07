import type { TaskStatus } from "@aop/common";
import { useMemo, useState } from "react";
import { ApiError, registerRepo, removeTask } from "../api/client";
import { BlockedBanner } from "../components/BlockedBanner";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { DirectoryBrowserDialog } from "../components/DirectoryBrowserDialog";
import { KanbanColumn } from "../components/KanbanColumn";
import { Logo } from "../components/Logo";
import { RepoFilter } from "../components/RepoFilter";
import { useConnectionStatus } from "../hooks/useConnectionStatus";
import { useTaskEvents } from "../hooks/useTaskEvents";
import type { Task } from "../types";

const KANBAN_COLUMNS: TaskStatus[] = ["DRAFT", "READY", "WORKING", "DONE"];

interface CapacityBarProps {
  working: number;
  max: number;
}

interface CapacitySegment {
  id: string;
  filled: boolean;
}

const buildCapacitySegments = (working: number, max: number): CapacitySegment[] => {
  const filled = Math.min(working, max);
  const segments: CapacitySegment[] = [];

  for (let i = 0; i < max; i++) {
    segments.push({ id: `slot-${i}`, filled: i < filled });
  }

  return segments;
};

const CapacityBar = ({ working, max }: CapacityBarProps) => {
  if (max === 0) return null;

  const segments = buildCapacitySegments(working, max);

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[11px] text-aop-slate-dark">CAPACITY</span>
      <div className="flex gap-0.5">
        {segments.map((segment) => (
          <div
            key={segment.id}
            className={`h-2 w-3 rounded-sm ${segment.filled ? "bg-aop-amber" : "bg-aop-charcoal"}`}
          />
        ))}
      </div>
      <span className="font-mono text-[11px] text-aop-slate-light">
        {working}/{max}
      </span>
    </div>
  );
};

interface KanbanBoardProps {
  onTaskClick?: (task: Task) => void;
  onNavigate?: (path: string) => void;
}

export const KanbanBoard = ({ onTaskClick, onNavigate }: KanbanBoardProps) => {
  const { tasks, capacity, repos, connected, initialized, refresh } = useTaskEvents();
  const connectionState = useConnectionStatus({ connected, tasks });
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [registerDialogOpen, setRegisterDialogOpen] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const filteredTasks = useMemo(() => {
    if (!selectedRepoId) return tasks;
    return tasks.filter((task) => task.repoId === selectedRepoId);
  }, [tasks, selectedRepoId]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      DRAFT: [],
      READY: [],
      WORKING: [],
      DONE: [],
      BLOCKED: [],
      REMOVED: [],
    };

    for (const task of filteredTasks) {
      grouped[task.status].push(task);
    }

    return grouped;
  }, [filteredTasks]);

  const handleRetry = (task: Task) => {
    fetch(`/api/repos/${task.repoId}/tasks/${task.id}/ready`, { method: "POST" });
  };

  const handleRemove = (task: Task) => {
    removeTask(task.repoId, task.id);
  };

  const handleRegisterSelect = async (path: string) => {
    setRegisterDialogOpen(false);
    setRegisterMessage(null);
    try {
      const result = await registerRepo(path);
      if (result.alreadyExists) {
        setRegisterMessage({ type: "success", text: "Repository already registered" });
      } else {
        setRegisterMessage({ type: "success", text: "Repository registered successfully" });
      }
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setRegisterMessage({ type: "error", text: err.message });
      } else {
        setRegisterMessage({ type: "error", text: "Failed to register repository" });
      }
    }
    setTimeout(() => setRegisterMessage(null), 4000);
  };

  return (
    <div className="flex min-h-screen flex-col bg-aop-black">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-aop-charcoal bg-aop-dark px-6">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => onNavigate?.("/")}
            className="cursor-pointer text-aop-cream transition-colors hover:text-aop-amber"
          >
            <Logo />
          </button>
          <RepoFilter repos={repos} selectedRepoId={selectedRepoId} onChange={setSelectedRepoId} />
          <button
            type="button"
            onClick={() => setRegisterDialogOpen(true)}
            className="cursor-pointer rounded-aop border border-aop-charcoal px-3 py-1.5 font-mono text-xs text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream"
          >
            + Register Repo
          </button>
        </div>

        <div className="flex items-center gap-6">
          <ConnectionStatus state={connectionState} />
          <CapacityBar working={capacity.working} max={capacity.max} />
          <nav className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate?.("/metrics")}
              className="cursor-pointer font-mono text-xs text-aop-slate transition-colors hover:text-aop-cream"
            >
              Metrics
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.("/settings")}
              className="cursor-pointer text-aop-slate transition-colors hover:text-aop-cream"
              title="Settings"
            >
              <svg
                role="img"
                aria-label="Settings"
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        {!initialized ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="font-mono text-sm text-aop-slate-dark">Connecting...</span>
          </div>
        ) : (
          <>
            <div className="grid flex-1 grid-cols-4 gap-px bg-aop-charcoal">
              {KANBAN_COLUMNS.map((status) => (
                <div key={status} className="bg-aop-black p-4">
                  <KanbanColumn
                    status={status}
                    tasks={tasksByStatus[status]}
                    onTaskClick={onTaskClick}
                  />
                </div>
              ))}
            </div>

            <BlockedBanner
              tasks={tasksByStatus.BLOCKED}
              onRetry={handleRetry}
              onRemove={handleRemove}
              onTaskClick={onTaskClick}
            />
          </>
        )}
      </main>

      <DirectoryBrowserDialog
        open={registerDialogOpen}
        onSelect={handleRegisterSelect}
        onCancel={() => setRegisterDialogOpen(false)}
      />

      {registerMessage && (
        <div
          className={`fixed bottom-4 right-4 rounded-aop-lg px-4 py-3 font-mono text-xs ${
            registerMessage.type === "success"
              ? "bg-aop-ready/20 text-aop-ready"
              : "bg-aop-blocked/20 text-aop-blocked"
          }`}
        >
          {registerMessage.text}
        </div>
      )}
    </div>
  );
};
