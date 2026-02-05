import type { TaskStatus } from "@aop/common";
import { useMemo, useState } from "react";
import { BlockedBanner } from "../components/BlockedBanner";
import { ConnectionStatus } from "../components/ConnectionStatus";
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
  const { tasks, capacity, repos, connected, initialized } = useTaskEvents();
  const connectionState = useConnectionStatus({ connected, tasks });
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);

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
        </div>

        <div className="flex items-center gap-6">
          <ConnectionStatus state={connectionState} />
          <CapacityBar working={capacity.working} max={capacity.max} />
          <nav>
            <button
              type="button"
              onClick={() => onNavigate?.("/metrics")}
              className="cursor-pointer font-mono text-xs text-aop-slate transition-colors hover:text-aop-cream"
            >
              Metrics
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
              onTaskClick={onTaskClick}
            />
          </>
        )}
      </main>
    </div>
  );
};
