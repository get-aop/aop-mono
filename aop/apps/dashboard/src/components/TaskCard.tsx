import type { Task } from "../types";

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

export const TaskCard = ({ task, onClick }: TaskCardProps) => {
  const repoName = task.repoPath?.split("/").pop() ?? task.repoPath ?? "";
  const changeName = task.changePath?.split("/").pop() ?? task.changePath ?? "";

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
      <span className="mt-1 block font-mono text-[10px] text-aop-slate-dark">{repoName}</span>
      {task.status === "BLOCKED" && task.errorMessage && (
        <span className="mt-2 block font-mono text-[10px] text-aop-blocked line-clamp-2">
          {task.errorMessage}
        </span>
      )}
    </button>
  );
};
