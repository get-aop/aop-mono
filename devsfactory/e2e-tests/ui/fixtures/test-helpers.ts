import type { Page, Route } from "@playwright/test";
import type {
  OrchestratorState,
  Task,
  Plan,
  Subtask,
  TaskStatus,
  SubtaskStatus,
  Priority
} from "../../../packages/dashboard/types";

export interface MockTaskOptions {
  folder?: string;
  title?: string;
  status?: TaskStatus;
  priority?: Priority;
  tags?: string[];
}

export interface MockSubtaskOptions {
  number?: number;
  title?: string;
  status?: SubtaskStatus;
  dependencies?: number[];
}

export const createMockTask = (options: MockTaskOptions = {}): Task => ({
  folder: options.folder ?? "test-task",
  frontmatter: {
    title: options.title ?? "Test Task",
    status: options.status ?? "PENDING",
    created: new Date("2026-01-01"),
    priority: options.priority ?? "medium",
    tags: options.tags ?? [],
    assignee: null,
    dependencies: []
  },
  description: "Test task description",
  requirements: "Test requirements",
  acceptanceCriteria: [
    { text: "First criterion", checked: false },
    { text: "Second criterion", checked: true }
  ]
});

export const createMockSubtask = (options: MockSubtaskOptions = {}): Subtask => {
  const number = options.number ?? 1;
  const slug = `subtask-${number}`;
  return {
    filename: `00${number}-${slug}.md`,
    number,
    slug,
    frontmatter: {
      title: options.title ?? `Subtask ${number}`,
      status: options.status ?? "PENDING",
      dependencies: options.dependencies ?? []
    },
    description: `Description for subtask ${number}`
  };
};

export const createMockPlan = (taskFolder: string, subtaskCount = 3): Plan => ({
  folder: taskFolder,
  frontmatter: {
    status: "INPROGRESS",
    task: taskFolder,
    created: new Date("2026-01-01")
  },
  subtasks: Array.from({ length: subtaskCount }, (_, i) => ({
    number: i + 1,
    slug: `subtask-${i + 1}`,
    title: `Subtask ${i + 1}`,
    dependencies: i > 0 ? [i] : []
  }))
});

export interface MockOrchestratorStateOptions {
  taskCount?: number;
  subtasksPerTask?: number;
  tasks?: Task[];
}

export const createMockOrchestratorState = (
  options: MockOrchestratorStateOptions = {}
): OrchestratorState => {
  const taskCount = options.taskCount ?? 2;
  const subtasksPerTask = options.subtasksPerTask ?? 3;

  const tasks =
    options.tasks ??
    Array.from({ length: taskCount }, (_, i) =>
      createMockTask({
        folder: `task-${i + 1}`,
        title: `Task ${i + 1}`,
        status: i === 0 ? "INPROGRESS" : "PENDING",
        priority: i === 0 ? "high" : "medium"
      })
    );

  const plans: Record<string, Plan> = {};
  const subtasks: Record<string, Subtask[]> = {};

  for (const task of tasks) {
    plans[task.folder] = createMockPlan(task.folder, subtasksPerTask);
    subtasks[task.folder] = Array.from({ length: subtasksPerTask }, (_, i) =>
      createMockSubtask({
        number: i + 1,
        status: i === 0 ? "INPROGRESS" : "PENDING",
        dependencies: i > 0 ? [i] : []
      })
    );
  }

  return { tasks, plans, subtasks };
};

export interface WaitForWebSocketOptions {
  timeout?: number;
}

export const waitForWebSocket = async (
  page: Page,
  options: WaitForWebSocketOptions = {}
): Promise<void> => {
  const timeout = options.timeout ?? 5000;

  await page.waitForFunction(
    () => {
      const wsReadyState = (window as { __wsReadyState?: number }).__wsReadyState;
      return wsReadyState === WebSocket.OPEN;
    },
    { timeout }
  );
};

export const injectWebSocketReadyState = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = class extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("open", () => {
          (window as { __wsReadyState?: number }).__wsReadyState = WebSocket.OPEN;
        });
        this.addEventListener("close", () => {
          (window as { __wsReadyState?: number }).__wsReadyState = WebSocket.CLOSED;
        });
      }
    } as typeof WebSocket;
  });
};

export interface MockApiResponseOptions {
  status?: number;
  delay?: number;
}

export const mockApiResponse = async (
  page: Page,
  urlPattern: string | RegExp,
  responseBody: unknown,
  options: MockApiResponseOptions = {}
): Promise<void> => {
  const status = options.status ?? 200;
  const delay = options.delay ?? 0;

  await page.route(urlPattern, async (route: Route) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(responseBody)
    });
  });
};

export const mockStateApi = async (
  page: Page,
  state: OrchestratorState
): Promise<void> => {
  await mockApiResponse(page, "**/api/state", state);
};

export interface MockWebSocketMessage {
  type: string;
  data?: unknown;
  [key: string]: unknown;
}

export const createMockWebSocketServer = (initialState: OrchestratorState) => {
  const messages: MockWebSocketMessage[] = [{ type: "state", data: initialState }];

  return {
    queueMessage: (message: MockWebSocketMessage) => {
      messages.push(message);
    },
    getMessages: () => [...messages]
  };
};
