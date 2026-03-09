import type { LocalServerContext } from "../../context.ts";
import type {
  InteractiveSession,
  InteractiveSessionUpdate,
  NewInteractiveSession,
  NewSessionMessage,
  SessionMessage,
} from "../../db/schema.ts";
import type { SessionRepository } from "../repository.ts";

type EventName = "message" | "question" | "completed" | "error";
type EventCallback = (...args: unknown[]) => void;

export interface MockEvent {
  event: EventName;
  args: unknown[];
}

export interface MockStep {
  method: "run" | "resume";
  sessionId?: string | null;
  events?: MockEvent[];
  throwMessage?: string;
  delayMs?: number;
}

export interface ClaudeCall {
  method: "run" | "resume";
  input: string;
  sessionId?: string;
}

export interface MockClaudeSession {
  session: {
    readonly sessionId: string | null;
    on: (event: string, listener: EventCallback) => void;
    off: (event: string, listener: EventCallback) => void;
    run: (_prompt: string) => Promise<void>;
    resume: (_sessionId: string, _answer: string) => Promise<void>;
    kill: () => void;
  };
  queueSteps: (...steps: MockStep[]) => void;
  calls: ClaudeCall[];
  wasKilled: () => boolean;
}

export const createMockClaudeSession = (): MockClaudeSession => {
  const listeners = new Map<string, EventCallback[]>();
  const steps: MockStep[] = [];
  const calls: ClaudeCall[] = [];
  let currentSessionId: string | null = null;
  let killed = false;

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };

  const getNextStep = (method: "run" | "resume"): MockStep => {
    const step = steps.shift();
    if (!step) {
      throw new Error(`No queued step for ${method}`);
    }
    if (step.method !== method) {
      throw new Error(`Expected ${step.method}, received ${method}`);
    }
    return step;
  };

  const applyStepSession = (step: MockStep): void => {
    if (step.sessionId !== undefined) {
      currentSessionId = step.sessionId;
    }
  };

  const maybeThrowStepError = (step: MockStep): void => {
    if (step.throwMessage) {
      throw new Error(step.throwMessage);
    }
  };

  const waitForStepDelay = async (step: MockStep): Promise<void> => {
    if (!step.delayMs) return;
    await new Promise((resolve) => setTimeout(resolve, step.delayMs));
  };

  const emitStepEvents = (step: MockStep): void => {
    for (const item of step.events ?? []) {
      emit(item.event, ...item.args);
    }
  };

  const runNextStep = async (method: "run" | "resume"): Promise<void> => {
    const step = getNextStep(method);
    applyStepSession(step);
    maybeThrowStepError(step);
    await waitForStepDelay(step);
    emitStepEvents(step);
  };

  return {
    session: {
      get sessionId() {
        return currentSessionId;
      },
      on: (event: string, listener: EventCallback) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      off: (event: string, listener: EventCallback) => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((registered) => registered !== listener),
        );
      },
      run: async (prompt: string) => {
        calls.push({ method: "run", input: prompt });
        await runNextStep("run");
      },
      resume: async (sessionId: string, answer: string) => {
        calls.push({ method: "resume", sessionId, input: answer });
        await runNextStep("resume");
      },
      kill: () => {
        killed = true;
      },
    },
    queueSteps: (...queuedSteps: MockStep[]) => {
      steps.push(...queuedSteps);
    },
    calls,
    wasKilled: () => killed,
  };
};

export const createInMemorySessionRepository = (): SessionRepository => {
  const sessions = new Map<string, InteractiveSession>();
  const messages = new Map<string, SessionMessage[]>();

  return {
    create: async (session: NewInteractiveSession): Promise<InteractiveSession> => {
      const now = new Date().toISOString();
      const created: InteractiveSession = {
        id: session.id,
        repo_id: session.repo_id ?? null,
        change_path: session.change_path ?? null,
        claude_session_id: session.claude_session_id,
        status: session.status,
        question_count: 0,
        continuation_count: 0,
        created_at: now,
        updated_at: now,
      };
      sessions.set(created.id, created);
      return created;
    },
    get: async (id: string): Promise<InteractiveSession | null> => sessions.get(id) ?? null,
    update: async (
      id: string,
      updates: InteractiveSessionUpdate,
    ): Promise<InteractiveSession | null> => {
      const existing = sessions.get(id);
      if (!existing) return null;
      const updated: InteractiveSession = {
        ...existing,
        ...updates,
        updated_at: new Date().toISOString(),
      };
      sessions.set(id, updated);
      return updated;
    },
    getActive: async (): Promise<InteractiveSession[]> => [...sessions.values()],
    addMessage: async (message: NewSessionMessage): Promise<SessionMessage> => {
      const created: SessionMessage = {
        id: message.id,
        session_id: message.session_id,
        role: message.role,
        content: message.content,
        tool_use_id: message.tool_use_id ?? null,
        created_at: new Date().toISOString(),
      };
      messages.set(message.session_id, [...(messages.get(message.session_id) ?? []), created]);
      return created;
    },
    getMessages: async (sessionId: string): Promise<SessionMessage[]> =>
      messages.get(sessionId) ?? [],
  };
};

export const createMockContext = (sessionRepository: SessionRepository): LocalServerContext => {
  return {
    sessionRepository,
    executionRepository: {} as LocalServerContext["executionRepository"],
    logBuffer: {} as LocalServerContext["logBuffer"],
    logFlusher: {} as LocalServerContext["logFlusher"],
    repoRepository: {
      create: async () => {
        throw new Error("repoRepository.create not implemented in mock context");
      },
      getByPath: async () => null,
      getById: async () => null,
      getAll: async () => [],
      remove: async () => false,
    },
    settingsRepository: {} as LocalServerContext["settingsRepository"],
    workflowRepository: {} as LocalServerContext["workflowRepository"],
    taskEventEmitter: {} as LocalServerContext["taskEventEmitter"],
    workflowService: {
      listWorkflows: async () => [],
      startTask: async () => ({ status: "READY" }),
      completeStep: async () => ({ taskStatus: "DONE", step: null }),
      resumeTask: async () => ({ taskStatus: "DONE", step: null }),
    },
    taskRepository: {
      refresh: async () => {},
      create: async () => {
        throw new Error("taskRepository.create not implemented in mock context");
      },
      createIdempotent: async () => null,
      get: async () => null,
      getByChangePath: async () => null,
      update: async () => null,
      markRemoved: async () => false,
      list: async () => [],
      countWorking: async () => 0,
      getNextExecutable: async () => null,
      getNextResumable: async () => null,
      resetStaleWorkingTasks: async () => 0,
      getMetrics: async () => ({
        total: 0,
        byStatus: {
          DRAFT: 0,
          READY: 0,
          RESUMING: 0,
          WORKING: 0,
          PAUSED: 0,
          BLOCKED: 0,
          DONE: 0,
          REMOVED: 0,
        },
        successRate: 0,
        avgDurationMs: 0,
        avgFailedDurationMs: 0,
      }),
    },
  };
};
