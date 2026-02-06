import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalServerContext } from "../context.ts";
import type {
  InteractiveSession,
  InteractiveSessionUpdate,
  NewInteractiveSession,
  NewSessionMessage,
  SessionMessage,
} from "../db/schema.ts";
import type { SessionRepository } from "../session/repository.ts";
import { createCreateTaskService } from "./service.ts";

type EventName = "message" | "question" | "completed" | "error";
type EventCallback = (...args: unknown[]) => void;

interface MockEvent {
  event: EventName;
  args: unknown[];
}

interface MockStep {
  method: "run" | "resume";
  sessionId?: string | null;
  events?: MockEvent[];
  throwMessage?: string;
  delayMs?: number;
}

interface ClaudeCall {
  method: "run" | "resume";
  input: string;
  sessionId?: string;
}

interface MockClaudeSession {
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

const createMockClaudeSession = (): MockClaudeSession => {
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

const createInMemorySessionRepository = (): SessionRepository => {
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

const createMockContext = (sessionRepository: SessionRepository): LocalServerContext => {
  return {
    sessionRepository,
    executionRepository: {} as LocalServerContext["executionRepository"],
    logBuffer: {} as LocalServerContext["logBuffer"],
    repoRepository: {} as LocalServerContext["repoRepository"],
    settingsRepository: {} as LocalServerContext["settingsRepository"],
    taskEventEmitter: {} as LocalServerContext["taskEventEmitter"],
    taskRepository: {} as LocalServerContext["taskRepository"],
  };
};

const completeOutput = (title = "Dashboard"): string => `[BRAINSTORM_COMPLETE]
{"title":"${title}","description":"Build dashboard","requirements":["R1"],"acceptanceCriteria":["A1"]}`;
const BRAINSTORM_COMPLETE_MARKER = "[BRAINSTORM_COMPLETE]";

const plainTextQuestionOutput = (
  question = "What's the main motivation for moving worktrees to ~/.aop?",
): string => `Question 1 [Motivation]: ${question}

1. Clean repo directory - avoid .worktrees in repo
2. Centralized management - use ~/.aop as single home

(Enter a number, or type a custom response)`;

const naturalQuestionPrefixOutput = (): string => `Now I have enough context.

My first question: choose the directory layout for worktrees

1. ~/.aop/worktrees/<repoId>/<taskId> - grouped by repository
2. ~/.aop/worktrees/<taskId> - flat by task id`;

describe("create-task/service", () => {
  let sessionRepository: SessionRepository;
  let ctx: LocalServerContext;
  let mockClaude: MockClaudeSession;
  const cleanupDirs: string[] = [];

  beforeEach(() => {
    sessionRepository = createInMemorySessionRepository();
    ctx = createMockContext(sessionRepository);
    mockClaude = createMockClaudeSession();
    cleanupDirs.length = 0;
  });

  afterEach(async () => {
    for (const dir of cleanupDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("starts session and returns question", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      events: [
        { event: "completed", args: [plainTextQuestionOutput("Which stack should we use?")] },
      ],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
      maxQuestions: 5,
    });

    expect(result.status).toBe("question");
    if (result.status !== "question") return;

    expect(result.question.question).toContain("Which stack");
    expect(result.questionCount).toBe(1);
    expect(result.assistantOutput).toContain("Question 1 [Motivation]");

    const stored = await sessionRepository.get(result.sessionId);
    expect(stored?.status).toBe("brainstorming");
    expect(stored?.question_count).toBe(1);
  });

  test("treats plain assistant text as question", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-plain-question",
      events: [{ event: "completed", args: [plainTextQuestionOutput()] }],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.start({
      description: "Move worktrees to ~/.aop",
      cwd: process.cwd(),
    });

    expect(result.status).toBe("question");
    if (result.status !== "question") return;
    expect(result.question.question).toContain("main motivation");
    expect(result.question.options?.[0]?.label).toContain("Clean repo directory");
    expect(result.assistantOutput).toContain("Question 1 [Motivation]");
  });

  test("parses natural 'first question' prefix without question mark", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-natural-question",
      events: [{ event: "completed", args: [naturalQuestionPrefixOutput()] }],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.start({
      description: "Move worktrees to ~/.aop",
      cwd: process.cwd(),
    });

    expect(result.status).toBe("question");
    if (result.status !== "question") return;
    expect(result.question.question).toContain("choose the directory layout");
    expect(result.question.options?.[0]?.label).toContain("~/.aop/worktrees/<repoId>/<taskId>");
    expect(result.assistantOutput).toContain("My first question");
  });

  test("returns error when Claude session ID is missing", async () => {
    mockClaude.queueSteps({
      method: "run",
      events: [{ event: "completed", args: [completeOutput()] }],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error).toBe("Failed to get Claude session ID");
    expect(result.assistantOutput).toContain(BRAINSTORM_COMPLETE_MARKER);
  });

  test("continues when output is not a question or completion", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      events: [{ event: "message", args: ["partial output"] }],
    });
    mockClaude.queueSteps({
      method: "resume",
      events: [{ event: "completed", args: [plainTextQuestionOutput("Q1?")] }],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });

    expect(result.status).toBe("question");
    if (result.status !== "question") return;

    expect(result.question.question).toContain("Q1?");
    const retryCall = mockClaude.calls.find((call) => call.method === "resume");
    expect(retryCall).toBeDefined();
  });

  test("marks session as error when Claude emits process error", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      events: [{ event: "error", args: [1] }],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;

    expect(result.error).toContain("exited with code 1");
    const stored = result.sessionId ? await sessionRepository.get(result.sessionId) : null;
    expect(stored?.status).toBe("error");
  });

  test("returns timeout error when Claude turn takes too long", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      delayMs: 20,
      events: [],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
      turnTimeoutMs: 5,
    });

    const result = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;

    expect(result.error).toContain("timed out");
    const stored = result.sessionId ? await sessionRepository.get(result.sessionId) : null;
    expect(stored?.status).toBe("error");
  });

  test("returns error after continuation retries are exhausted", async () => {
    mockClaude.queueSteps(
      {
        method: "run",
        sessionId: "claude-session-1",
        events: [{ event: "message", args: ["partial output"] }],
      },
      { method: "resume", events: [{ event: "message", args: ["partial output"] }] },
      { method: "resume", events: [{ event: "message", args: ["partial output"] }] },
      { method: "resume", events: [{ event: "message", args: ["partial output"] }] },
    );

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;

    expect(result.error).toContain("without completion after 3 attempts");
    expect(result.assistantOutput).toBe("partial output");
    const stored = result.sessionId ? await sessionRepository.get(result.sessionId) : null;
    expect(stored?.status).toBe("error");
  });

  test("answer returns not_found for unknown session", async () => {
    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.answer({ sessionId: "missing", answer: "React" });
    expect(result).toEqual({
      status: "error",
      code: "not_found",
      sessionId: "missing",
      error: "Session not found",
    });
  });

  test("answer returns invalid_state when session is not awaiting input", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      events: [{ event: "completed", args: [completeOutput()] }],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const started = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });
    expect(started.status).toBe("completed");
    if (started.status !== "completed") return;
    expect(started.assistantOutput).toContain(BRAINSTORM_COMPLETE_MARKER);

    const result = await service.answer({ sessionId: started.sessionId, answer: "React" });

    expect(result).toEqual({
      status: "error",
      code: "invalid_state",
      sessionId: started.sessionId,
      error: "Session is not waiting for an answer",
    });
  });

  test("forwards answer without max-question note", async () => {
    mockClaude.queueSteps(
      {
        method: "run",
        sessionId: "claude-session-1",
        events: [{ event: "completed", args: [plainTextQuestionOutput("Which stack?")] }],
      },
      { method: "resume", events: [{ event: "completed", args: [completeOutput()] }] },
    );

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const first = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
      maxQuestions: 1,
    });

    expect(first.status).toBe("question");
    if (first.status !== "question") return;

    const second = await service.answer({
      sessionId: first.sessionId,
      answer: "React",
    });

    expect(second.status).toBe("completed");
    const answerCall = mockClaude.calls.at(-1);
    expect(answerCall?.input).toBe("React");
  });

  test("finalize returns not_found for unknown session", async () => {
    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.finalize({
      sessionId: "missing",
      createChange: false,
    });

    expect(result).toEqual({
      status: "error",
      code: "not_found",
      sessionId: "missing",
      error: "Session not found",
    });
  });

  test("finalize returns invalid_state when requirements are missing", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      events: [{ event: "completed", args: [plainTextQuestionOutput("Which stack?")] }],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const started = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });

    expect(started.status).toBe("question");
    if (started.status !== "question") return;

    const result = await service.finalize({
      sessionId: started.sessionId,
      createChange: false,
    });

    expect(result).toEqual({
      status: "error",
      code: "invalid_state",
      sessionId: started.sessionId,
      error: "No requirements gathered",
    });
  });

  test("finalize without change marks session completed", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      events: [{ event: "completed", args: [completeOutput()] }],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const started = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });

    expect(started.status).toBe("completed");
    if (started.status !== "completed") return;
    expect(started.assistantOutput).toContain(BRAINSTORM_COMPLETE_MARKER);

    const finalized = await service.finalize({
      sessionId: started.sessionId,
      createChange: false,
    });

    expect(finalized.status).toBe("success");
    if (finalized.status !== "success") return;

    expect(finalized.changeName).toBeUndefined();
    const stored = await sessionRepository.get(finalized.sessionId);
    expect(stored?.status).toBe("completed");

    const answerAfterFinalize = await service.answer({
      sessionId: finalized.sessionId,
      answer: "anything",
    });
    expect(answerAfterFinalize.status).toBe("error");
    if (answerAfterFinalize.status === "error") {
      expect(answerAfterFinalize.code).toBe("not_found");
    }
  });

  test("finalize with change runs opsx:new and opsx:ff", async () => {
    mockClaude.queueSteps(
      {
        method: "run",
        sessionId: "claude-session-1",
        events: [{ event: "completed", args: [completeOutput("My Feature!!!")] }],
      },
      {
        method: "resume",
        sessionId: "claude-session-new",
        events: [{ event: "completed", args: ["created change"] }],
      },
      {
        method: "resume",
        sessionId: "claude-session-ff",
        events: [{ event: "completed", args: ["generated artifacts"] }],
      },
    );

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const started = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });

    expect(started.status).toBe("completed");
    if (started.status !== "completed") return;
    expect(started.assistantOutput).toContain(BRAINSTORM_COMPLETE_MARKER);

    const finalized = await service.finalize({
      sessionId: started.sessionId,
      createChange: true,
    });

    expect(finalized.status).toBe("success");
    if (finalized.status !== "success") return;

    expect(finalized.changeName).toBe("my-feature");
    const resumeInputs = mockClaude.calls
      .filter((call) => call.method === "resume")
      .map((call) => call.input);
    expect(resumeInputs).toContain("/opsx:new");
    expect(resumeInputs).toContain("/opsx:ff");
  });

  test("handles background question with auto-answer during finalize", async () => {
    mockClaude.queueSteps(
      {
        method: "run",
        sessionId: "claude-session-1",
        events: [{ event: "completed", args: [completeOutput("Scoped Feature")] }],
      },
      {
        method: "resume",
        events: [{ event: "completed", args: [plainTextQuestionOutput("Confirm name?")] }],
      },
      {
        method: "resume",
        sessionId: "claude-session-2",
        events: [{ event: "completed", args: ["created change"] }],
      },
      {
        method: "resume",
        events: [{ event: "completed", args: ["generated artifacts"] }],
      },
    );

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const started = await service.start({
      description: "Build a dashboard",
      cwd: process.cwd(),
    });

    expect(started.status).toBe("completed");
    if (started.status !== "completed") return;
    expect(started.assistantOutput).toContain(BRAINSTORM_COMPLETE_MARKER);

    const finalized = await service.finalize({
      sessionId: started.sessionId,
      createChange: true,
    });

    expect(finalized.status).toBe("success");
    if (finalized.status !== "success") return;

    expect(finalized.changeName).toBe("scoped-feature");
    const resumeInputs = mockClaude.calls
      .filter((call) => call.method === "resume")
      .map((call) => call.input);
    expect(resumeInputs).toContain("/opsx:new");
    expect(resumeInputs).toContain("scoped-feature");
  });

  test("saves a draft when change creation fails", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "aop-create-task-draft-"));
    cleanupDirs.push(testDir);

    mockClaude.queueSteps(
      {
        method: "run",
        sessionId: "claude-session-1",
        events: [{ event: "completed", args: [completeOutput("Draft Feature")] }],
      },
      { method: "resume", events: [{ event: "error", args: [1] }] },
      { method: "resume", events: [{ event: "error", args: [1] }] },
    );

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const started = await service.start({ description: "Build a dashboard", cwd: testDir });
    expect(started.status).toBe("completed");
    if (started.status !== "completed") return;
    expect(started.assistantOutput).toContain(BRAINSTORM_COMPLETE_MARKER);

    const finalized = await service.finalize({
      sessionId: started.sessionId,
      createChange: true,
    });

    expect(finalized.status).toBe("success");
    if (finalized.status !== "success") return;

    expect(finalized.warning).toContain("Change creation failed after retries");
    expect(finalized.draftPath).toBeTruthy();
    expect(finalized.changeName).toBeUndefined();
    expect(await Bun.file(finalized.draftPath || "").exists()).toBe(true);
  });

  test("returns warning when artifact generation fails", async () => {
    mockClaude.queueSteps(
      {
        method: "run",
        sessionId: "claude-session-1",
        events: [{ event: "completed", args: [completeOutput("Artifact Feature")] }],
      },
      {
        method: "resume",
        sessionId: "claude-session-2",
        events: [{ event: "completed", args: ["created change"] }],
      },
      { method: "resume", events: [{ event: "error", args: [1] }] },
      { method: "resume", events: [{ event: "error", args: [1] }] },
    );

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const started = await service.start({ description: "Build a dashboard", cwd: process.cwd() });
    expect(started.status).toBe("completed");
    if (started.status !== "completed") return;

    const finalized = await service.finalize({
      sessionId: started.sessionId,
      createChange: true,
    });

    expect(finalized.status).toBe("success");
    if (finalized.status !== "success") return;

    expect(finalized.changeName).toBe("artifact-feature");
    expect(finalized.warning).toBe("Change created, but artifact generation failed.");
  });

  test("cancel kills Claude session and marks session cancelled", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      events: [{ event: "completed", args: [plainTextQuestionOutput("Which stack?")] }],
    });

    const service = createCreateTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const started = await service.start({ description: "Build a dashboard", cwd: process.cwd() });
    expect(started.status).toBe("question");
    if (started.status !== "question") return;

    const cancelled = await service.cancel({ sessionId: started.sessionId });
    expect(cancelled).toEqual({ status: "success", sessionId: started.sessionId });
    expect(mockClaude.wasKilled()).toBe(true);

    const stored = await sessionRepository.get(started.sessionId);
    expect(stored?.status).toBe("cancelled");

    const secondCancel = await service.cancel({ sessionId: started.sessionId });
    expect(secondCancel.status).toBe("error");
    if (secondCancel.status === "error") {
      expect(secondCancel.code).toBe("not_found");
    }
  });
});
