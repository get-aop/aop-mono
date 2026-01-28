import { useDashboardStore } from "../context";
import { ConnectedActivityFeed } from "./ActivityFeed";
import { DAGView } from "./DAGView";
import { ConnectedReviewPanel } from "./ReviewPanel";
import { TaskList } from "./TaskList";

const TaskDetail = () => {
  const selectedTask = useDashboardStore((s) => s.selectedTask);
  const tasks = useDashboardStore((s) => s.tasks);
  const plans = useDashboardStore((s) => s.plans);
  const subtasks = useDashboardStore((s) => s.subtasks);
  const activeAgents = useDashboardStore((s) => s.activeAgents);

  const task = tasks.find((t) => t.folder === selectedTask);

  if (!task) {
    return (
      <>
        <h2>Task Detail</h2>
        <p>Select a task to view details</p>
      </>
    );
  }

  if (task.frontmatter.status === "REVIEW") {
    return <ConnectedReviewPanel task={task} />;
  }

  const plan = plans[task.folder];
  const taskSubtasks = subtasks[task.folder] ?? [];
  const runningSubtasks = new Set(
    Array.from(activeAgents.values())
      .filter((a) => a.taskFolder === task.folder && a.subtaskFile)
      .map((a) => a.subtaskFile)
  );

  return (
    <>
      <h2>{task.frontmatter.title}</h2>
      {plan ? (
        <DAGView
          plan={plan}
          subtasks={taskSubtasks}
          running={runningSubtasks}
        />
      ) : (
        <p>No plan available</p>
      )}
    </>
  );
};

export const Layout = () => (
  <div className="layout">
    <aside className="sidebar">
      <h2>Task List</h2>
      <TaskList />
    </aside>
    <main className="main">
      <TaskDetail />
    </main>
    <section className="feed">
      <ConnectedActivityFeed />
    </section>
  </div>
);
