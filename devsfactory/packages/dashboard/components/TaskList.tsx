import { useDashboardStore } from "../context";
import { TaskCard } from "./TaskCard";

export const TaskList = () => {
  const tasks = useDashboardStore((s) => s.tasks);
  const subtasks = useDashboardStore((s) => s.subtasks);
  const selectedTask = useDashboardStore((s) => s.selectedTask);
  const selectTask = useDashboardStore((s) => s.selectTask);
  const activeAgents = useDashboardStore((s) => s.activeAgents);
  const setTaskStatus = useDashboardStore((s) => s.setTaskStatus);

  const hasActiveAgent = (folder: string) =>
    Array.from(activeAgents.values()).some((a) => a.taskFolder === folder);

  if (tasks.length === 0) {
    return (
      <div className="task-list">
        <p className="task-list-empty">No tasks</p>
      </div>
    );
  }

  return (
    <div className="task-list">
      {tasks.map((task) => (
        <TaskCard
          key={task.folder}
          task={task}
          subtasks={subtasks[task.folder] ?? []}
          selected={selectedTask === task.folder}
          hasActiveAgent={hasActiveAgent(task.folder)}
          onClick={() => selectTask(task.folder)}
          onStatusChange={(status) => setTaskStatus(task.folder, status)}
        />
      ))}
    </div>
  );
};
