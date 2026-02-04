import type { TaskStatus } from "@aop/common";
import type { Task } from "../types";
import { StatusBadge } from "./StatusBadge";
import { TaskCard } from "./TaskCard";

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
}

export const KanbanColumn = ({ status, tasks, onTaskClick }: KanbanColumnProps) => {
  return (
    <div className="flex flex-col" data-testid={`kanban-column-${status}`}>
      <div className="mb-4 flex items-center gap-2">
        <StatusBadge status={status} />
        <span className="font-mono text-[11px] text-aop-slate-dark">{tasks.length}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onClick={() => onTaskClick?.(task)} />
        ))}
      </div>
    </div>
  );
};
