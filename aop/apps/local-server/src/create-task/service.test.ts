import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalServerContext } from "../context.ts";
import type { SessionRepository } from "../session/repository.ts";
import {
  createInMemorySessionRepository,
  createMockClaudeSession,
  createMockContext,
  type MockClaudeSession,
} from "../session/test-utils/index.ts";
import { createCreateTaskService } from "./service.ts";

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
