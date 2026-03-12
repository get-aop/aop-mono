import { describe, expect, test } from "bun:test";
import {
  AbortReason,
  AuthRequestSchema,
  AuthResponseSchema,
  ErrorCode,
  StepCommandSchema,
  StepCompleteRequestSchema,
  StepCompleteResponseSchema,
  TaskReadyRequestSchema,
  TaskReadyResponseSchema,
  TaskStatusResponseSchema,
} from "./index";

describe("Protocol Types", () => {
  describe("AuthRequest", () => {
    test("validates request with optional maxConcurrentTasks", () => {
      const result = AuthRequestSchema.safeParse({
        requestedMaxConcurrentTasks: 3,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.requestedMaxConcurrentTasks).toBe(3);
      }
    });

    test("validates empty request", () => {
      const result = AuthRequestSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    test("rejects invalid maxConcurrentTasks type", () => {
      const result = AuthRequestSchema.safeParse({
        requestedMaxConcurrentTasks: "not-a-number",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("AuthResponse", () => {
    test("validates response with clientId and effectiveMaxConcurrentTasks", () => {
      const result = AuthResponseSchema.safeParse({
        clientId: "client_xxx",
        effectiveMaxConcurrentTasks: 5,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.clientId).toBe("client_xxx");
        expect(result.data.effectiveMaxConcurrentTasks).toBe(5);
      }
    });

    test("rejects missing required fields", () => {
      const result = AuthResponseSchema.safeParse({
        clientId: "client_xxx",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("TaskReadyRequest", () => {
    test("validates request with repoId", () => {
      const result = TaskReadyRequestSchema.safeParse({
        repoId: "repo_xxx",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("StepCommand", () => {
    test("validates step command with all fields", () => {
      const result = StepCommandSchema.safeParse({
        id: "step_xxx",
        type: "implement",
        promptTemplate: "Implement the task: {{ task.description }}",
        attempt: 1,
        iteration: 0,
        agent: {
          provider: "openai",
          model: "gpt-5.4",
          reasoning: "high",
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe("step_xxx");
        expect(result.data.type).toBe("implement");
        expect(result.data.attempt).toBe(1);
        expect(result.data.iteration).toBe(0);
        expect(result.data.agent).toEqual({
          provider: "openai",
          model: "gpt-5.4",
          reasoning: "high",
        });
      }
    });
  });

  describe("TaskReadyResponse", () => {
    test("validates response with workflow started (WORKING)", () => {
      const result = TaskReadyResponseSchema.safeParse({
        status: "WORKING",
        execution: {
          id: "exec_xxx",
          workflowId: "workflow_xxx",
        },
        step: {
          id: "step_xxx",
          type: "implement",
          promptTemplate: "Implement the task",
          attempt: 1,
          iteration: 0,
        },
      });
      expect(result.success).toBe(true);
    });

    test("validates response when queued", () => {
      const result = TaskReadyResponseSchema.safeParse({
        status: "READY",
        queued: true,
        message: "Task queued, at max concurrent tasks",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.queued).toBe(true);
      }
    });
  });

  describe("StepCompleteRequest", () => {
    test("validates success request", () => {
      const result = StepCompleteRequestSchema.safeParse({
        executionId: "exec_xxx",
        attempt: 1,
        status: "success",
        durationMs: 180000,
      });
      expect(result.success).toBe(true);
    });

    test("validates failure request with error", () => {
      const result = StepCompleteRequestSchema.safeParse({
        executionId: "exec_xxx",
        attempt: 1,
        status: "failure",
        error: {
          code: "agent_timeout",
          message: "Agent exceeded timeout",
        },
        durationMs: 300000,
      });
      expect(result.success).toBe(true);
    });

    test("validates aborted request with reason", () => {
      const result = StepCompleteRequestSchema.safeParse({
        executionId: "exec_xxx",
        attempt: 1,
        status: "failure",
        error: {
          code: "aborted",
          reason: "task_removed",
          message: "Task was removed by user",
        },
        durationMs: 45000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.error?.code).toBe("aborted");
        expect(result.data.error?.reason).toBe("task_removed");
      }
    });
  });

  describe("StepCompleteResponse", () => {
    test("validates response with next step", () => {
      const result = StepCompleteResponseSchema.safeParse({
        taskStatus: "WORKING",
        step: {
          id: "step_yyy",
          type: "test",
          promptTemplate: "Run tests for the implementation",
          attempt: 1,
          iteration: 0,
        },
      });
      expect(result.success).toBe(true);
    });

    test("validates response when workflow complete (DONE)", () => {
      const result = StepCompleteResponseSchema.safeParse({
        taskStatus: "DONE",
        step: null,
      });
      expect(result.success).toBe(true);
    });

    test("validates response when workflow blocked", () => {
      const result = StepCompleteResponseSchema.safeParse({
        taskStatus: "BLOCKED",
        step: null,
        error: {
          code: "max_retries_exceeded",
          message: "Step failed after 3 attempts",
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("TaskStatusResponse", () => {
    test("validates response with execution info", () => {
      const result = TaskStatusResponseSchema.safeParse({
        status: "WORKING",
        execution: {
          id: "exec_xxx",
          currentStepId: "step_xxx",
          awaitingResult: true,
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.execution?.awaitingResult).toBe(true);
      }
    });

    test("validates response without execution (task not running)", () => {
      const result = TaskStatusResponseSchema.safeParse({
        status: "READY",
      });
      expect(result.success).toBe(true);
    });

    test("validates dependency wait details separately from task lifecycle", () => {
      const result = TaskStatusResponseSchema.safeParse({
        status: "READY",
        dependencyState: "waiting",
        blockedByTaskIds: ["task-upstream"],
        blockedByRefs: ["ABC-120"],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Error Codes", () => {
    test("defines all agent error codes", () => {
      expect(ErrorCode.AGENT_TIMEOUT).toBe("agent_timeout");
      expect(ErrorCode.AGENT_CRASH).toBe("agent_crash");
      expect(ErrorCode.SCRIPT_FAILED).toBe("script_failed");
      expect(ErrorCode.ABORTED).toBe("aborted");
    });

    test("defines all server error codes", () => {
      expect(ErrorCode.MAX_RETRIES_EXCEEDED).toBe("max_retries_exceeded");
      expect(ErrorCode.PROMPT_NOT_FOUND).toBe("prompt_not_found");
    });
  });

  describe("Abort Reasons", () => {
    test("defines all abort reasons", () => {
      expect(AbortReason.TASK_REMOVED).toBe("task_removed");
      expect(AbortReason.CHANGE_FILES_DELETED).toBe("change_files_deleted");
    });
  });
});
