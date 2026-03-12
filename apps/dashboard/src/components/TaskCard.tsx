import { useEffect, useState } from "react";
import type { Task } from "../types";
import { formatDuration } from "../utils/format";
import { TaskProgress } from "./TaskProgress";

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
}

const getStatusDotColor = (status: Task["status"]) => {
  switch (status) {
    case "DRAFT":
      return "bg-aop-charcoal";
    case "READY":
      return "bg-aop-amber";
    case "WORKING":
      return "bg-aop-working";
    case "DONE":
      return "bg-aop-success";
    case "BLOCKED":
      return "bg-aop-blocked";
    case "REMOVED":
      return "bg-aop-slate-dark";
    default:
      return "bg-aop-charcoal";
  }
};

const TaskDuration = ({ task }: { task: Task }) => {
  const [, setTick] = useState(0);
  const isLive = task.status === "WORKING";

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  if (!task.executionStartedAt) return null;

  const showDuration = task.status === "WORKING" || task.status === "DONE";
  if (!showDuration) return null;

  const duration = formatDuration(task.executionStartedAt, task.executionCompletedAt);

  return (
    <span data-testid="task-duration" className="font-mono text-[10px] text-aop-slate-dark">
      {duration}
      {isLive && "..."}
    </span>
  );
};

const getDependencyNotice = (task: Task): { message: string; tone: string } | null => {
  if (task.dependencyState === "waiting") {
    const refs = task.blockedByRefs?.length ? task.blockedByRefs.join(", ") : "upstream tasks";
    return {
      message: `Waiting on ${refs}`,
      tone: "text-aop-amber",
    };
  }

  if (task.dependencyState === "blocked") {
    const refs = task.blockedByRefs?.length
      ? task.blockedByRefs.join(", ")
      : "blocked upstream task";
    return {
      message: `Blocked by ${refs}`,
      tone: "text-aop-blocked",
    };
  }

  return null;
};

export const TaskCard = ({ task, onClick }: TaskCardProps) => {
  const repoName = task.repoPath?.split("/").pop() ?? task.repoPath ?? "";
  const changeName = task.changePath?.split("/").pop() ?? task.changePath ?? "";
  const dependencyNotice = getDependencyNotice(task);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`task-card-${task.id}`}
      className="w-full cursor-pointer rounded-aop border border-aop-charcoal bg-aop-dark p-4 text-left transition-colors hover:border-aop-slate-dark"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-body text-sm text-aop-cream">{changeName}</span>
        <div className={`h-2 w-2 shrink-0 rounded-full ${getStatusDotColor(task.status)}`} />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="font-mono text-[10px] text-aop-slate-dark">{repoName}</span>
        <TaskDuration task={task} />
        {task.taskProgress && (
          <TaskProgress completed={task.taskProgress.completed} total={task.taskProgress.total} />
        )}
      </div>
      {dependencyNotice && (
        <span
          data-testid="task-dependency-state"
          className={`mt-2 block font-mono text-[10px] ${dependencyNotice.tone}`}
        >
          {dependencyNotice.message}
        </span>
      )}
      {task.status === "BLOCKED" && task.errorMessage && (
        <span className="mt-2 block font-mono text-[10px] text-aop-blocked line-clamp-2">
          {task.errorMessage}
        </span>
      )}
    </button>
  );
};
