import { useEffect, useState } from "react";
import type { Task } from "./types";
import { KanbanBoard } from "./views/KanbanBoard";
import { MetricsPage } from "./views/MetricsPage";
import { TaskDetail } from "./views/TaskDetail";

type Route = "board" | "metrics" | "detail";

interface RouterState {
  route: Route;
  taskId?: string;
}

const parseRoute = (): RouterState => {
  const path = window.location.pathname;

  if (path === "/metrics") {
    return { route: "metrics" };
  }

  const taskMatch = path.match(/^\/tasks\/(.+)$/);
  if (taskMatch) {
    return { route: "detail", taskId: taskMatch[1] };
  }

  return { route: "board" };
};

export const App = () => {
  const [routerState, setRouterState] = useState<RouterState>(parseRoute);

  useEffect(() => {
    const handlePopState = () => {
      setRouterState(parseRoute());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setRouterState(parseRoute());
  };

  const handleTaskClick = (task: Task) => {
    navigate(`/tasks/${task.id}`);
  };

  if (routerState.route === "board") {
    return <KanbanBoard onTaskClick={handleTaskClick} onNavigate={navigate} />;
  }

  if (routerState.route === "metrics") {
    return <MetricsPage onNavigate={navigate} />;
  }

  if (routerState.route === "detail" && routerState.taskId) {
    return (
      <TaskDetail taskId={routerState.taskId} onClose={() => navigate("/")} onNavigate={navigate} />
    );
  }

  return null;
};
