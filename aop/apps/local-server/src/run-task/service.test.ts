import { beforeEach, describe, expect, test } from "bun:test";
import type { LocalServerContext } from "../context.ts";
import type { SessionRepository } from "../session/repository.ts";
import {
  createInMemorySessionRepository,
  createMockClaudeSession,
  createMockContext,
  type MockClaudeSession,
} from "../session/test-utils/index.ts";
import { createRunTaskService } from "./service.ts";

describe("run-task/service", () => {
  let sessionRepository: SessionRepository;
  let ctx: LocalServerContext;
  let mockClaude: MockClaudeSession;

  beforeEach(() => {
    sessionRepository = createInMemorySessionRepository();
    ctx = createMockContext(sessionRepository);
    mockClaude = createMockClaudeSession();
  });

  test("runs opsx:new and opsx:ff successfully", async () => {
    mockClaude.queueSteps(
      {
        method: "run",
        sessionId: "claude-session-1",
        events: [{ event: "completed", args: ["created change"] }],
      },
      {
        method: "resume",
        sessionId: "claude-session-2",
        events: [{ event: "completed", args: ["generated artifacts"] }],
      },
    );

    const service = createRunTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.run({ changeName: "my-feature", cwd: process.cwd() });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.changeName).toBe("my-feature");
    expect(result.warning).toBeUndefined();
    expect(mockClaude.wasKilled()).toBe(true);

    const runCall = mockClaude.calls.find((call) => call.method === "run");
    expect(runCall?.input).toBe("/opsx:new my-feature");

    const resumeCall = mockClaude.calls.find((call) => call.method === "resume");
    expect(resumeCall?.input).toBe("/opsx:ff");

    const stored = await sessionRepository.get(result.sessionId);
    expect(stored?.status).toBe("completed");
  });

  test("returns error when Claude session ID is missing", async () => {
    mockClaude.queueSteps({
      method: "run",
      events: [{ event: "completed", args: ["created change"] }],
    });

    const service = createRunTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.run({ changeName: "my-feature", cwd: process.cwd() });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error).toBe("Failed to get Claude session ID");
    expect(mockClaude.wasKilled()).toBe(true);
  });

  test("returns error when opsx:new fails", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      events: [{ event: "error", args: [1] }],
    });

    const service = createRunTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.run({ changeName: "my-feature", cwd: process.cwd() });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error).toContain("exited with code 1");
    expect(mockClaude.wasKilled()).toBe(true);
  });

  test("returns success with warning when opsx:ff fails", async () => {
    mockClaude.queueSteps(
      {
        method: "run",
        sessionId: "claude-session-1",
        events: [{ event: "completed", args: ["created change"] }],
      },
      {
        method: "resume",
        events: [{ event: "error", args: [1] }],
      },
      {
        method: "resume",
        events: [{ event: "error", args: [1] }],
      },
    );

    const service = createRunTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.run({ changeName: "my-feature", cwd: process.cwd() });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.changeName).toBe("my-feature");
    expect(result.warning).toBe("Change created, but artifact generation failed.");
    expect(mockClaude.wasKilled()).toBe(true);

    const stored = await sessionRepository.get(result.sessionId);
    expect(stored?.status).toBe("error");
  });

  test("handles background question with auto-answer during opsx:ff", async () => {
    mockClaude.queueSteps(
      {
        method: "run",
        sessionId: "claude-session-1",
        events: [{ event: "completed", args: ["created change"] }],
      },
      {
        method: "resume",
        events: [
          {
            event: "completed",
            args: ["Choose option:\n1. Option A\n2. Option B\n(Enter a number)"],
          },
        ],
      },
      {
        method: "resume",
        sessionId: "claude-session-2",
        events: [{ event: "completed", args: ["generated artifacts"] }],
      },
    );

    const service = createRunTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.run({ changeName: "my-feature", cwd: process.cwd() });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.changeName).toBe("my-feature");
    expect(result.warning).toBeUndefined();

    const resumeInputs = mockClaude.calls
      .filter((call) => call.method === "resume")
      .map((call) => call.input);
    expect(resumeInputs).toContain("my-feature");
  });

  test("returns error when run throws", async () => {
    mockClaude.queueSteps({
      method: "run",
      sessionId: "claude-session-1",
      throwMessage: "Connection failed",
    });

    const service = createRunTaskService(ctx, {
      createClaudeSession: () => mockClaude.session as never,
    });

    const result = await service.run({ changeName: "my-feature", cwd: process.cwd() });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error).toBe("Connection failed");
    expect(mockClaude.wasKilled()).toBe(true);
  });
});
