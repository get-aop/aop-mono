import { useState } from "react";
import type { Step, Task } from "../types";
import { RetryDialog } from "./RetryDialog";
import { StatusBadge } from "./StatusBadge";

interface BlockedBannerProps {
  tasks: Task[];
  stepsMap?: Record<string, Step[]>;
  onRetry?: (task: Task, stepId?: string) => void;
  onTaskClick?: (task: Task) => void;
}

export const BlockedBanner = ({
  tasks,
  stepsMap = {},
  onRetry,
  onTaskClick,
}: BlockedBannerProps) => {
  const [retryTarget, setRetryTarget] = useState<Task | null>(null);

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
            const repoName = task.repoPath?.split("/").pop() ?? task.repoPath ?? "";
            const changeName = task.changePath?.split("/").pop() ?? task.changePath ?? "";

            return (
              <button
                type="button"
                key={task.id}
                onClick={() => onTaskClick?.(task)}
                data-testid={`blocked-task-${task.id}`}
                className="flex min-w-[280px] cursor-pointer flex-col rounded-aop border border-aop-blocked/50 bg-aop-dark p-4 text-left transition-colors hover:border-aop-blocked/80 hover:bg-aop-dark/80"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-body text-sm text-aop-cream">{changeName}</span>
                  <div className="flex gap-1">
                    {onRetry && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRetryTarget(task);
                        }}
                        data-testid={`retry-button-${task.id}`}
                        className="flex cursor-pointer items-center gap-1 rounded-aop bg-aop-charcoal px-2 py-1 font-mono text-[10px] text-aop-cream transition-colors hover:bg-aop-slate-dark"
                      >
                        Retry
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <span className="mt-1 font-mono text-[10px] text-aop-slate-dark">{repoName}</span>
                {task.errorMessage && (
                  <span className="mt-2 font-mono text-[10px] text-aop-blocked line-clamp-2">
                    {task.errorMessage}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <RetryDialog
        open={!!retryTarget}
        task={retryTarget}
        steps={retryTarget ? (stepsMap[retryTarget.id] ?? []) : []}
        onSelect={(task, stepId) => {
          onRetry?.(task, stepId);
          setRetryTarget(null);
        }}
        onCancel={() => setRetryTarget(null)}
      />
    </div>
  );
};
