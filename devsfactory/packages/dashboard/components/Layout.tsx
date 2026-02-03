import { useDashboardStore } from "../context";
import { ConnectedActivityFeed } from "./ActivityFeed";
import { DAGView } from "./DAGView";
import { ConnectedReviewPanel } from "./ReviewPanel";
import { ConnectedSubtaskDetailPanel } from "./SubtaskDetailPanel";
import { TaskList } from "./TaskList";

const TaskDetail = () => {
  const selectedTask = useDashboardStore((s) => s.selectedTask);
  const tasks = useDashboardStore((s) => s.tasks);
  const plans = useDashboardStore((s) => s.plans);
  const subtasks = useDashboardStore((s) => s.subtasks);

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

  return (
    <>
      <h2>{task.frontmatter.title}</h2>
      {taskSubtasks.length > 0 ? (
        <DAGView subtasks={taskSubtasks} taskFolder={task.folder} />
      ) : plan ? (
        <p>Plan exists but no subtasks loaded</p>
      ) : (
        <p>No plan or subtasks available</p>
      )}
    </>
  );
};

const FeedPanel = () => {
  const selectedSubtask = useDashboardStore((s) => s.selectedSubtask);

  if (selectedSubtask) {
    return <ConnectedSubtaskDetailPanel />;
  }

  return <ConnectedActivityFeed />;
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
      <FeedPanel />
    </section>
  </div>
);
