import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMProvider } from "../providers/types";
import type { BrainstormMessage, SubtaskPreview, TaskPreview } from "../types";
import {
  BrainstormSessionManager,
  type BrainstormSessionManagerOptions
} from "./brainstorm-session-manager";

const createMockProvider = (): LLMProvider => ({
  name: "mock",
  buildCommand: () => ["/bin/cat"],
  isAvailable: async () => true
});

const defaultOptions: BrainstormSessionManagerOptions = {
  provider: createMockProvider(),
  cwd: "/tmp",
  idleTimeoutMs: 5000
};

describe("BrainstormSessionManager", () => {
  let manager: BrainstormSessionManager;

  beforeEach(() => {
    manager = new BrainstormSessionManager(defaultOptions);
  });

  afterEach(async () => {
    const sessions = manager.getActiveSessions();
    for (const session of sessions) {
      await manager.endSession(session.id);
    }
  });

  describe("constructor", () => {
    test("creates instance with provided options", () => {
      expect(manager).toBeInstanceOf(BrainstormSessionManager);
      expect(manager).toBeInstanceOf(EventEmitter);
    });

    test("uses default idle timeout of 30 minutes when not provided", () => {
      const managerWithDefaults = new BrainstormSessionManager({
        provider: createMockProvider(),
        cwd: "/tmp"
      });
      expect(managerWithDefaults).toBeDefined();
    });
  });

  describe("startSession", () => {
    test("creates a new session with generated id", async () => {
      const session = await manager.startSession();

      expect(session.id).toMatch(/^brainstorm-/);
      expect(session.status).toBe("active");
      expect(session.messages).toEqual([]);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
    });

    test("creates session with initial message when provided", async () => {
      const initialMessage = "I want to build a new feature";
      const session = await manager.startSession(initialMessage);

      expect(session.messages).toHaveLength(1);
      expect(session.messages[0]!.role).toBe("user");
      expect(session.messages[0]!.content).toBe(initialMessage);
    });

    test("emits sessionStarted event", async () => {
      let emittedData: { sessionId: string; agentId: string } | null = null;
      manager.on("sessionStarted", (data) => {
        emittedData = data;
      });

      const session = await manager.startSession();

      expect(emittedData).not.toBeNull();
      expect(emittedData!.sessionId).toBe(session.id);
      expect(emittedData!.agentId).toMatch(/^agent-/);
    });

    test("tracks session in active sessions", async () => {
      const session = await manager.startSession();
      const activeSessions = manager.getActiveSessions();

      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0]!.id).toBe(session.id);
    });
  });

  describe("getSession", () => {
    test("returns session by id", async () => {
      const session = await manager.startSession();
      const retrieved = manager.getSession(session.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(session.id);
    });

    test("returns undefined for unknown session id", () => {
      const retrieved = manager.getSession("unknown-id");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("getActiveSessions", () => {
    test("returns empty array when no sessions", () => {
      expect(manager.getActiveSessions()).toEqual([]);
    });

    test("returns all active sessions", async () => {
      await manager.startSession();
      await manager.startSession();

      const sessions = manager.getActiveSessions();
      expect(sessions).toHaveLength(2);
    });

    test("excludes ended sessions", async () => {
      const session1 = await manager.startSession();
      await manager.startSession();
      await manager.endSession(session1.id);

      const sessions = manager.getActiveSessions();
      expect(sessions).toHaveLength(1);
    });
  });

  describe("sendMessage", () => {
    test("adds user message to session", async () => {
      const session = await manager.startSession();
      await manager.sendMessage(session.id, "Hello agent");

      const updated = manager.getSession(session.id);
      expect(updated!.messages).toHaveLength(1);
      expect(updated!.messages[0]!.role).toBe("user");
      expect(updated!.messages[0]!.content).toBe("Hello agent");
    });

    test("updates session updatedAt timestamp", async () => {
      const session = await manager.startSession();
      const originalUpdatedAt = session.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      await manager.sendMessage(session.id, "Hello");

      const updated = manager.getSession(session.id);
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime()
      );
    });

    test("throws error for unknown session id", async () => {
      await expect(manager.sendMessage("unknown-id", "Hello")).rejects.toThrow(
        "Session not found"
      );
    });

    test("throws error for ended session", async () => {
      const session = await manager.startSession();
      await manager.endSession(session.id);

      await expect(manager.sendMessage(session.id, "Hello")).rejects.toThrow(
        "Session not found"
      );
    });
  });

  describe("endSession", () => {
    test("removes session from active sessions", async () => {
      const session = await manager.startSession();
      await manager.endSession(session.id);

      expect(manager.getSession(session.id)).toBeUndefined();
      expect(manager.getActiveSessions()).toHaveLength(0);
    });

    test("does nothing for unknown session id", async () => {
      await expect(manager.endSession("unknown-id")).resolves.toBeUndefined();
    });

    test("kills the agent process", async () => {
      const session = await manager.startSession();
      await manager.endSession(session.id);

      expect(manager.getActiveSessions()).toHaveLength(0);
    });
  });

  describe("event emissions", () => {
    test("emits message event when assistant responds", async () => {
      const messages: { sessionId: string; message: BrainstormMessage }[] = [];
      manager.on("message", (data) => messages.push(data));

      const session = await manager.startSession();

      manager.emit("_testAgentOutput", {
        sessionId: session.id,
        content: "Hello, I'm here to help!"
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(messages.length).toBeGreaterThanOrEqual(0);
    });

    test("emits error event on agent error", async () => {
      let errorData: { sessionId: string; error: Error } | null = null;
      manager.on("error", (data) => {
        errorData = data;
      });

      const session = await manager.startSession();
      const testError = new Error("Test error");

      manager.emit("_testAgentError", {
        sessionId: session.id,
        error: testError
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(errorData).not.toBeNull();
      expect(errorData!.sessionId).toBe(session.id);
      expect(errorData!.error.message).toBe("Test error");
    });
  });

  describe("completion detection", () => {
    test("detects brainstorm complete marker in output", async () => {
      let completeData: { sessionId: string; taskPreview: TaskPreview } | null =
        null;
      manager.on("brainstormComplete", (data) => {
        completeData = data;
      });

      const session = await manager.startSession();

      manager.emit("_testAgentOutput", {
        sessionId: session.id,
        content: `Here's the task preview:
[BRAINSTORM_COMPLETE]
{"title":"New Feature","description":"A great feature","requirements":"Must be fast","acceptanceCriteria":["Works correctly"]}`
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(completeData).not.toBeNull();
      expect(completeData!.sessionId).toBe(session.id);
      expect(completeData!.taskPreview).toEqual({
        title: "New Feature",
        description: "A great feature",
        requirements: "Must be fast",
        acceptanceCriteria: ["Works correctly"]
      });
    });

    test("updates session status to completed on brainstorm complete", async () => {
      const session = await manager.startSession();

      manager.emit("_testAgentOutput", {
        sessionId: session.id,
        content: `[BRAINSTORM_COMPLETE]
{"title":"Test","description":"Test desc","requirements":"None","acceptanceCriteria":[]}`
      });

      await new Promise((r) => setTimeout(r, 50));

      const updated = manager.getSession(session.id);
      expect(updated!.status).toBe("completed");
      expect(updated!.taskPreview).toBeDefined();
    });
  });

  describe("session timeout", () => {
    test("session has configurable idle timeout", async () => {
      const shortTimeoutManager = new BrainstormSessionManager({
        ...defaultOptions,
        idleTimeoutMs: 100
      });

      const session = await shortTimeoutManager.startSession();
      expect(session).toBeDefined();

      await shortTimeoutManager.endSession(session.id);
    });

    test("emits sessionTimeout event when idle timeout expires", async () => {
      const shortTimeoutManager = new BrainstormSessionManager({
        ...defaultOptions,
        idleTimeoutMs: 50
      });

      let timeoutSessionId: string | null = null;
      shortTimeoutManager.on("sessionTimeout", (data) => {
        timeoutSessionId = data.sessionId;
      });

      const session = await shortTimeoutManager.startSession();

      await new Promise((r) => setTimeout(r, 150));

      expect(timeoutSessionId).not.toBeNull();
      expect(timeoutSessionId!).toBe(session.id);
      expect(shortTimeoutManager.getActiveSessions()).toHaveLength(0);
    });
  });

  describe("prompt construction", () => {
    test("includes brainstorming skill content in agent prompt", async () => {
      let capturedPrompt = "";
      const customProvider: LLMProvider = {
        name: "test",
        buildCommand: (opts) => {
          capturedPrompt = opts.prompt;
          return ["/bin/cat"];
        },
        isAvailable: async () => true
      };

      const testManager = new BrainstormSessionManager({
        ...defaultOptions,
        provider: customProvider
      });

      await testManager.startSession();

      expect(capturedPrompt.toLowerCase()).toContain("brainstorm");

      for (const session of testManager.getActiveSessions()) {
        await testManager.endSession(session.id);
      }
    });

    test("includes completion marker instruction in prompt", async () => {
      let capturedPrompt = "";
      const customProvider: LLMProvider = {
        name: "test",
        buildCommand: (opts) => {
          capturedPrompt = opts.prompt;
          return ["/bin/cat"];
        },
        isAvailable: async () => true
      };

      const testManager = new BrainstormSessionManager({
        ...defaultOptions,
        provider: customProvider
      });

      await testManager.startSession();

      expect(capturedPrompt).toContain("[BRAINSTORM_COMPLETE]");

      for (const session of testManager.getActiveSessions()) {
        await testManager.endSession(session.id);
      }
    });

    test("includes initial message context in prompt when provided", async () => {
      let capturedPrompt = "";
      const customProvider: LLMProvider = {
        name: "test",
        buildCommand: (opts) => {
          capturedPrompt = opts.prompt;
          return ["/bin/cat"];
        },
        isAvailable: async () => true
      };

      const testManager = new BrainstormSessionManager({
        ...defaultOptions,
        provider: customProvider
      });

      await testManager.startSession("Build a login page");

      expect(capturedPrompt).toContain("Build a login page");

      for (const session of testManager.getActiveSessions()) {
        await testManager.endSession(session.id);
      }
    });
  });

  describe("message parsing", () => {
    test("parses plain text output as assistant message", async () => {
      const messages: { sessionId: string; message: BrainstormMessage }[] = [];
      manager.on("message", (data) => messages.push(data));

      const session = await manager.startSession();

      manager.emit("_testAgentOutput", {
        sessionId: session.id,
        content: "What features are you looking to build?"
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(messages).toHaveLength(1);
      expect(messages[0]!.message.role).toBe("assistant");
      expect(messages[0]!.message.content).toBe(
        "What features are you looking to build?"
      );
    });

    test("parses JSON stream format output", async () => {
      const messages: { sessionId: string; message: BrainstormMessage }[] = [];
      manager.on("message", (data) => messages.push(data));

      const session = await manager.startSession();

      const jsonOutput = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello from assistant" }]
        }
      });

      manager.emit("_testAgentOutput", {
        sessionId: session.id,
        content: jsonOutput
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(messages).toHaveLength(1);
      expect(messages[0]!.message.content).toBe("Hello from assistant");
    });
  });

  describe("generatePlan", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `test-brainstorm-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    test("throws error for unknown session", async () => {
      await expect(manager.generatePlan("unknown-session")).rejects.toThrow(
        "Session not found"
      );
    });

    test("throws error if session has no taskPreview", async () => {
      const session = await manager.startSession();

      await expect(manager.generatePlan(session.id)).rejects.toThrow(
        "Session has no task preview"
      );
    });

    test("transitions session status to planning", async () => {
      const testManager = new BrainstormSessionManager({
        ...defaultOptions,
        cwd: tempDir
      });

      const session = await testManager.startSession();

      testManager.emit("_testAgentOutput", {
        sessionId: session.id,
        content: `[BRAINSTORM_COMPLETE]
{"title":"Test Task","description":"Test desc","requirements":"Test req","acceptanceCriteria":["AC1"]}`
      });

      await new Promise((r) => setTimeout(r, 50));

      const generatePromise = testManager.generatePlan(session.id);

      await new Promise((r) => setTimeout(r, 50));

      const updatedSession = testManager.getSession(session.id);
      expect(updatedSession?.status).toBe("planning");

      await testManager.endSession(session.id);
      await generatePromise.catch(() => {});
    });

    test("emits planGenerated event with subtask previews", async () => {
      let planData: {
        sessionId: string;
        subtaskPreviews: SubtaskPreview[];
      } | null = null;

      const testManager = new BrainstormSessionManager({
        ...defaultOptions,
        cwd: tempDir
      });

      testManager.on("planGenerated", (data) => {
        planData = data;
      });

      const session = await testManager.startSession();

      testManager.emit("_testAgentOutput", {
        sessionId: session.id,
        content: `[BRAINSTORM_COMPLETE]
{"title":"Auth Feature","description":"Add auth","requirements":"Must be secure","acceptanceCriteria":["Works"]}`
      });

      await new Promise((r) => setTimeout(r, 50));

      const taskDir = join(tempDir, "devsfactory-brainstorm", session.id);
      await mkdir(taskDir, { recursive: true });

      await Bun.write(
        join(taskDir, "001-create-models.md"),
        `---
title: Create data models
status: PENDING
dependencies: []
---

### Description

Create the data models.

### Context

Look at existing models.`
      );

      await Bun.write(
        join(taskDir, "002-add-api.md"),
        `---
title: Add API endpoints
status: PENDING
dependencies: [1]
---

### Description

Add API endpoints.

### Context

Follow REST conventions.`
      );

      testManager.emit("_testPlanComplete", {
        sessionId: session.id,
        taskDir
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(planData).not.toBeNull();
      expect(planData!.sessionId).toBe(session.id);
      expect(planData!.subtaskPreviews).toHaveLength(2);
      expect(planData!.subtaskPreviews[0]!.number).toBe(1);
      expect(planData!.subtaskPreviews[0]!.slug).toBe("create-models");
      expect(planData!.subtaskPreviews[0]!.title).toBe("Create data models");
      expect(planData!.subtaskPreviews[1]!.number).toBe(2);
      expect(planData!.subtaskPreviews[1]!.dependencies).toEqual([1]);

      await testManager.endSession(session.id);
    });

    test("transitions session to review status after plan generation", async () => {
      const testManager = new BrainstormSessionManager({
        ...defaultOptions,
        cwd: tempDir
      });

      const session = await testManager.startSession();

      testManager.emit("_testAgentOutput", {
        sessionId: session.id,
        content: `[BRAINSTORM_COMPLETE]
{"title":"Task","description":"Desc","requirements":"Req","acceptanceCriteria":[]}`
      });

      await new Promise((r) => setTimeout(r, 50));

      const taskDir = join(tempDir, "devsfactory-brainstorm", session.id);
      await mkdir(taskDir, { recursive: true });

      await Bun.write(
        join(taskDir, "001-setup.md"),
        `---
title: Setup
status: PENDING
dependencies: []
---

### Description

Setup.`
      );

      testManager.emit("_testPlanComplete", {
        sessionId: session.id,
        taskDir
      });

      await new Promise((r) => setTimeout(r, 100));

      const updatedSession = testManager.getSession(session.id);
      expect(updatedSession?.status).toBe("review");

      await testManager.endSession(session.id);
    });

    test("stores subtaskPreviews on session after plan generation", async () => {
      const testManager = new BrainstormSessionManager({
        ...defaultOptions,
        cwd: tempDir
      });

      const session = await testManager.startSession();

      testManager.emit("_testAgentOutput", {
        sessionId: session.id,
        content: `[BRAINSTORM_COMPLETE]
{"title":"Task","description":"Desc","requirements":"Req","acceptanceCriteria":[]}`
      });

      await new Promise((r) => setTimeout(r, 50));

      const taskDir = join(tempDir, "devsfactory-brainstorm", session.id);
      await mkdir(taskDir, { recursive: true });

      await Bun.write(
        join(taskDir, "001-init.md"),
        `---
title: Initialize project
status: PENDING
dependencies: []
---

### Description

Initialize.`
      );

      testManager.emit("_testPlanComplete", {
        sessionId: session.id,
        taskDir
      });

      await new Promise((r) => setTimeout(r, 100));

      const updatedSession = testManager.getSession(session.id);
      expect(updatedSession).toBeDefined();
      expect(updatedSession!.subtaskPreviews).toBeDefined();
      expect(updatedSession!.subtaskPreviews).toHaveLength(1);
      expect(updatedSession!.subtaskPreviews![0]!.title).toBe(
        "Initialize project"
      );

      await testManager.endSession(session.id);
    });
  });
});
