import type { Task } from "../types";
import { StatusBadge } from "./StatusBadge";

interface BlockedBannerProps {
  tasks: Task[];
  onRetry?: (task: Task) => void;
  onRemove?: (task: Task) => void;
}

export const BlockedBanner = ({ tasks, onRetry, onRemove }: BlockedBannerProps) => {
  if (tasks.length === 0) return null;

  return (
    <div
      className="border-t border-aop-blocked/30 bg-aop-blocked/[0.08]"
      data-testid="blocked-banner"
    >
      <div className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <StatusBadge status="BLOCKED" />
          <span className="font-mono text-[11px] text-aop-slate-dark">{tasks.length}</span>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {tasks.map((task) => {
            const repoName = task.repoPath.split("/").pop() ?? task.repoPath;
            const changeName = task.changePath.split("/").pop() ?? task.changePath;

            return (
              <div
                key={task.id}
                data-testid={`blocked-task-${task.id}`}
                className="flex min-w-[280px] flex-col rounded-aop border border-aop-blocked/50 bg-aop-dark p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-body text-sm text-aop-cream">{changeName}</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onRetry?.(task)}
                      data-testid={`retry-button-${task.id}`}
                      className="cursor-pointer rounded-aop bg-aop-charcoal px-2 py-1 font-mono text-[10px] text-aop-cream transition-colors hover:bg-aop-slate-dark"
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove?.(task)}
                      data-testid={`remove-button-${task.id}`}
                      className="cursor-pointer rounded-aop border border-aop-charcoal px-2 py-1 font-mono text-[10px] text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <span className="mt-1 font-mono text-[10px] text-aop-slate-dark">{repoName}</span>
                {task.errorMessage && (
                  <span className="mt-2 font-mono text-[10px] text-aop-blocked line-clamp-2">
                    {task.errorMessage}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
