import type { Page, Route } from "@playwright/test";
import type {
  OrchestratorState,
  Task,
  Plan,
  Subtask,
  TaskStatus,
  SubtaskStatus,
  Priority,
  BrainstormMessage,
  BrainstormDraft,
  TaskPreview,
  SubtaskPreview
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

export interface MockBrainstormMessageOptions {
  id?: string;
  role?: "user" | "assistant";
  content?: string;
  timestamp?: Date;
}

export const createMockBrainstormMessage = (
  options: MockBrainstormMessageOptions = {}
): BrainstormMessage => ({
  id: options.id ?? `msg-${Date.now()}`,
  role: options.role ?? "assistant",
  content: options.content ?? "What would you like to build?",
  timestamp: options.timestamp ?? new Date()
});

export interface MockBrainstormDraftOptions {
  sessionId?: string;
  messages?: BrainstormMessage[];
  partialTaskData?: Partial<TaskPreview>;
  status?: "active" | "brainstorming" | "planning" | "review" | "completed" | "cancelled";
  createdAt?: Date;
  updatedAt?: Date;
}

export const createMockBrainstormDraft = (
  options: MockBrainstormDraftOptions = {}
): BrainstormDraft => ({
  sessionId: options.sessionId ?? `brainstorm-${Date.now()}`,
  messages: options.messages ?? [
    createMockBrainstormMessage({ role: "assistant", content: "What would you like to build?" }),
    createMockBrainstormMessage({ role: "user", content: "A new feature" })
  ],
  partialTaskData: options.partialTaskData ?? { title: "Draft Task" },
  status: options.status ?? "active",
  createdAt: options.createdAt ?? new Date("2026-01-15"),
  updatedAt: options.updatedAt ?? new Date("2026-01-15")
});

export interface MockTaskPreviewOptions {
  title?: string;
  description?: string;
  requirements?: string;
  acceptanceCriteria?: string[];
}

export const createMockTaskPreview = (
  options: MockTaskPreviewOptions = {}
): TaskPreview => ({
  title: options.title ?? "New Feature",
  description: options.description ?? "A new feature for the application",
  requirements: options.requirements ?? "Must be implemented correctly",
  acceptanceCriteria: options.acceptanceCriteria ?? [
    "Feature works as expected",
    "Tests pass"
  ]
});

export interface MockSubtaskPreviewOptions {
  number?: number;
  slug?: string;
  title?: string;
  description?: string;
  context?: string;
  dependencies?: number[];
}

export const createMockSubtaskPreview = (
  options: MockSubtaskPreviewOptions = {}
): SubtaskPreview & { number?: number; slug?: string; context?: string } => ({
  number: options.number,
  slug: options.slug,
  title: options.title ?? "Subtask",
  description: options.description ?? "Subtask description",
  context: options.context,
  dependencies: options.dependencies ?? []
});

export const createMockSubtaskPreviews = (count = 3): SubtaskPreview[] =>
  Array.from({ length: count }, (_, i) =>
    createMockSubtaskPreview({
      number: i + 1,
      slug: `subtask-${i + 1}`,
      title: `Subtask ${i + 1}`,
      description: `Description for subtask ${i + 1}`,
      dependencies: i > 0 ? [i] : []
    })
  );

export const mockBrainstormStartApi = async (
  page: Page,
  response: { sessionId: string; agentId: string } = {
    sessionId: "brainstorm-test-session",
    agentId: "agent-test"
  }
): Promise<void> => {
  await page.route("**/api/brainstorm/start", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response)
    });
  });
};

export const mockBrainstormMessageApi = async (page: Page): Promise<void> => {
  await page.route("**/api/brainstorm/*/message", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({})
    });
  });
};

export const mockBrainstormEndApi = async (
  page: Page,
  response: { draftId?: string } = {}
): Promise<void> => {
  await page.route("**/api/brainstorm/*/end", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response)
    });
  });
};

export const mockBrainstormConfirmApi = async (page: Page): Promise<void> => {
  await page.route("**/api/brainstorm/*/confirm", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({})
    });
  });
};

export const mockBrainstormApproveApi = async (
  page: Page,
  response: { taskFolder: string } = { taskFolder: "create-task" }
): Promise<void> => {
  await page.route("**/api/brainstorm/*/approve", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response)
    });
  });
};

export const mockBrainstormDraftsApi = async (
  page: Page,
  drafts: BrainstormDraft[] = []
): Promise<void> => {
  await page.route("**/api/brainstorm/drafts", async (route: Route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ drafts })
      });
    } else {
      await route.continue();
    }
  });
};

export const mockBrainstormResumeDraftApi = async (
  page: Page,
  response: { sessionId: string; agentId: string } = {
    sessionId: "resumed-session",
    agentId: "resumed-agent"
  }
): Promise<void> => {
  await page.route("**/api/brainstorm/drafts/*/resume", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response)
    });
  });
};

export const mockBrainstormDeleteDraftApi = async (page: Page): Promise<void> => {
  await page.route("**/api/brainstorm/drafts/*", async (route: Route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({})
      });
    } else {
      await route.continue();
    }
  });
};

export const mockAllBrainstormApis = async (page: Page): Promise<void> => {
  await mockBrainstormStartApi(page);
  await mockBrainstormMessageApi(page);
  await mockBrainstormEndApi(page);
  await mockBrainstormConfirmApi(page);
  await mockBrainstormApproveApi(page);
  await mockBrainstormDraftsApi(page);
  await mockBrainstormResumeDraftApi(page);
  await mockBrainstormDeleteDraftApi(page);
};

export const simulateBrainstormWebSocketEvent = async (
  page: Page,
  event: MockWebSocketMessage
): Promise<void> => {
  await page.evaluate((eventData) => {
    const wsInstance = (window as { __mockWebSocket?: WebSocket }).__mockWebSocket;
    if (wsInstance) {
      const mockEvent = new MessageEvent("message", {
        data: JSON.stringify(eventData)
      });
      wsInstance.dispatchEvent(mockEvent);
    }
  }, event);
};

export const injectMockWebSocket = async (
  page: Page,
  initialState: OrchestratorState
): Promise<void> => {
  await page.addInitScript((stateData) => {
    const OriginalWebSocket = window.WebSocket;
    (window as { __mockWebSocket?: WebSocket }).__mockWebSocket = undefined;

    window.WebSocket = class extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        (window as { __mockWebSocket?: WebSocket }).__mockWebSocket = this;

        setTimeout(() => {
          const mockEvent = new MessageEvent("message", {
            data: JSON.stringify({ type: "state", data: stateData })
          });
          this.dispatchEvent(mockEvent);
        }, 50);
      }
    } as typeof WebSocket;
  }, initialState);
};
