import type { Subtask, Task, TaskStatus } from "../types";
import { StatusBadge } from "./StatusBadge";
import { StatusToggle } from "./StatusToggle";

interface TaskCardProps {
  task: Task;
  subtasks: Subtask[];
  selected?: boolean;
  hasActiveAgent?: boolean;
  onClick: () => void;
  onStatusChange?: (status: TaskStatus) => void;
}

export const TaskCard = ({
  task,
  subtasks,
  selected,
  hasActiveAgent,
  onClick,
  onStatusChange
}: TaskCardProps) => {
  const doneCount = subtasks.filter(
    (s) => s.frontmatter.status === "DONE"
  ).length;
  const totalCount = subtasks.length;
  const progress =
    totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    // biome-ignore lint/a11y/useSemanticElements: Cannot use button as it contains StatusToggle button
    <div
      role="button"
      tabIndex={0}
      className={`task-card ${selected ? "selected" : ""}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="task-card-header">
        <span className="task-card-title">{task.frontmatter.title}</span>
        {hasActiveAgent && <span className="agent-indicator" />}
      </div>
      <div className="task-card-meta">
        <StatusBadge status={task.frontmatter.status} active={hasActiveAgent} />
        {onStatusChange && (
          <StatusToggle
            status={task.frontmatter.status}
            onTransition={onStatusChange}
          />
        )}
        <span className="task-card-count">
          {doneCount}/{totalCount}
        </span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="progress-text">{progress}%</span>
    </div>
  );
};
