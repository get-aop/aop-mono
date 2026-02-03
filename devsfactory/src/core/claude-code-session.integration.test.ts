import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeSession, runClaudeCodeSession } from "./claude-code-session";

const isCI = process.env.CI === "true" || process.env.CI === "1";
const runClaudeTests = process.env.RUN_CLAUDE_TESTS === "true";

/**
 * Integration tests for ClaudeCodeSession
 *
 * These tests actually invoke Claude Code and verify the behavior.
 * They require:
 * - Claude Code installed and authenticated
 * - Network access to Anthropic API
 *
 * Run with: bun test src/core/claude-code-session.integration.test.ts
 *
 * These tests are skipped in CI environments (set CI=true to skip).
 */
describe.skipIf(isCI || !runClaudeTests)(
  "ClaudeCodeSession Integration",
  () => {
    it("should run a simple session and get a response", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "claude-session-test-"));

      try {
        const result = await runClaudeCodeSession({
          cwd: tempDir,
          prompt: 'Say exactly "test123" and nothing else',
          dangerouslySkipPermissions: true,
          maxTurns: 1,
          maxBudgetUsd: 0.1
        });

        expect(result.status).toBe("completed");
        expect(result.sessionId).toBeTruthy();
        expect(result.output).toContain("test123");
        expect(result.usage).toBeDefined();
        expect(result.usage?.totalCostUsd).toBeGreaterThan(0);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }, 30000);

    it("should track session ID from stream output", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "claude-session-test-"));

      try {
        const session = new ClaudeCodeSession();

        let capturedSessionId: string | undefined;
        session.on("output", ({ parsed }) => {
          if (parsed?.type === "system" && parsed.sessionId) {
            capturedSessionId = parsed.sessionId;
          }
        });

        const result = await session.run({
          cwd: tempDir,
          prompt: 'Say "hello"',
          dangerouslySkipPermissions: true,
          maxTurns: 1,
          maxBudgetUsd: 0.1
        });

        expect(result.sessionId).toBeTruthy();
        expect(capturedSessionId).toBe(result.sessionId);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }, 30000);

    it("should emit toolUse events when tools are called", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "claude-session-test-"));

      try {
        // Create a test file
        await Bun.write(join(tempDir, "test.txt"), "hello world");

        const session = new ClaudeCodeSession();

        const toolUseEvents: string[] = [];
        session.on("toolUse", ({ toolName }) => {
          toolUseEvents.push(toolName);
        });

        const result = await session.run({
          cwd: tempDir,
          prompt: "Read the file test.txt and tell me what it contains",
          dangerouslySkipPermissions: true,
          maxTurns: 3,
          maxBudgetUsd: 0.2
        });

        expect(result.status).toBe("completed");
        expect(toolUseEvents).toContain("Read");
        expect(result.output).toContain("hello world");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }, 60000);

    it("should resume a session successfully", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "claude-session-test-"));

      try {
        // First session
        const session1Result = await runClaudeCodeSession({
          cwd: tempDir,
          prompt: 'Remember the number 42. Say "remembered".',
          dangerouslySkipPermissions: true,
          maxTurns: 1,
          maxBudgetUsd: 0.1
        });

        expect(session1Result.status).toBe("completed");
        expect(session1Result.sessionId).toBeTruthy();

        // Resume session
        const session2Result = await runClaudeCodeSession({
          cwd: tempDir,
          prompt: "What number did I ask you to remember?",
          resume: session1Result.sessionId,
          dangerouslySkipPermissions: true,
          maxTurns: 1,
          maxBudgetUsd: 0.1
        });

        expect(session2Result.status).toBe("completed");
        expect(session2Result.output).toContain("42");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }, 60000);

    it("should respect max-turns limit", async () => {
      const tempDir = await mkdtemp(join(tmpdir(), "claude-session-test-"));

      try {
        const session = new ClaudeCodeSession();

        let turnCount = 0;
        session.on("output", ({ parsed }) => {
          if (parsed?.type === "assistant") {
            turnCount++;
          }
        });

        const result = await session.run({
          cwd: tempDir,
          prompt: "Count from 1 to 10, one number at a time",
          dangerouslySkipPermissions: true,
          maxTurns: 2,
          maxBudgetUsd: 0.1
        });

        expect(result.status).toBe("completed");
        // With maxTurns=2, should not complete all 10 numbers
        expect(turnCount).toBeLessThanOrEqual(2);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }, 30000);

    it("should handle errors gracefully", async () => {
      const session = new ClaudeCodeSession();

      // Use a non-existent directory to cause an error
      const result = await session.run({
        cwd: "/non-existent-directory-that-should-not-exist-12345",
        prompt: "hello",
        dangerouslySkipPermissions: true,
        maxTurns: 1
      });

      expect(result.status).toBe("error");
      expect(result.error).toBeTruthy();
    }, 10000);
  }
);
