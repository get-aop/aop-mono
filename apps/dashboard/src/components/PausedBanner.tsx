import type { Task } from "../types";
import { StatusBadge } from "./StatusBadge";

interface PausedBannerProps {
  tasks: Task[];
  onResume?: (task: Task) => void;
  onTaskClick?: (task: Task) => void;
}

export const PausedBanner = ({ tasks, onResume, onTaskClick }: PausedBannerProps) => {
  if (tasks.length === 0) return null;

  return (
    <div className="border-t border-aop-amber/30 bg-aop-amber/[0.08]" data-testid="paused-banner">
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <StatusBadge status="PAUSED" />
          <span className="font-mono text-[11px] text-aop-slate-dark">{tasks.length}</span>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {tasks.map((task) => {
            const repoName = task.repoPath?.split("/").pop() ?? task.repoPath ?? "";
            const changeName = task.changePath?.split("/").pop() ?? task.changePath ?? "";

            return (
              <div
                key={task.id}
                role="button"
                tabIndex={0}
                onClick={() => onTaskClick?.(task)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onTaskClick?.(task);
                  }
                }}
                data-testid={`paused-task-${task.id}`}
                className="flex min-w-[280px] cursor-pointer flex-col rounded-aop border border-aop-amber/50 bg-aop-dark p-4 text-left transition-colors hover:border-aop-amber/80 hover:bg-aop-dark/80"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-body text-sm text-aop-cream">{changeName}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onResume?.(task);
                    }}
                    data-testid={`resume-button-${task.id}`}
                    className="cursor-pointer rounded-aop bg-aop-amber px-2 py-1 font-mono text-[10px] text-aop-black transition-colors hover:bg-aop-amber-light"
                  >
                    Resume
                  </button>
                </div>
                <span className="mt-1 font-mono text-[10px] text-aop-slate-dark">{repoName}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
