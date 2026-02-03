import { describe, expect, it } from "bun:test";
import { ClaudeCodeSession, runClaudeCodeSession } from "./claude-code-session";

describe("ClaudeCodeSession", () => {
  describe("buildCommand", () => {
    const getBuildCommand = (session: ClaudeCodeSession) =>
      (
        session as unknown as {
          buildCommand: (binary: string, opts: unknown) => string[];
        }
      ).buildCommand.bind(session);

    it("should build basic command with defaults", async () => {
      const session = new ClaudeCodeSession();
      const buildCommand = getBuildCommand(session);

      const cmd = buildCommand("claude", {
        cwd: "/test",
        prompt: "hello"
      });

      expect(cmd).toContain("claude");
      expect(cmd).toContain("--output-format");
      expect(cmd).toContain("stream-json");
      expect(cmd).toContain("--verbose");
      expect(cmd).toContain("--dangerously-skip-permissions"); // Always enabled
      expect(cmd).toContain("hello");
    });

    it("should include resume flag when resuming", async () => {
      const session = new ClaudeCodeSession();
      const buildCommand = getBuildCommand(session);

      const cmd = buildCommand("claude", {
        cwd: "/test",
        prompt: "answer",
        resume: "session-123"
      });

      expect(cmd).toContain("--resume");
      expect(cmd).toContain("session-123");
    });

    it("should include model when specified", async () => {
      const session = new ClaudeCodeSession();
      const buildCommand = getBuildCommand(session);

      const cmd = buildCommand("claude", {
        cwd: "/test",
        prompt: "hello",
        model: "opus"
      });

      expect(cmd).toContain("--model");
      expect(cmd).toContain("opus");
    });

    it("should include tool restrictions when specified", async () => {
      const session = new ClaudeCodeSession();
      const buildCommand = getBuildCommand(session);

      const cmd = buildCommand("claude", {
        cwd: "/test",
        prompt: "hello",
        allowedTools: ["Read", "Write"],
        disallowedTools: ["Bash"]
      });

      expect(cmd).toContain("--allowedTools");
      expect(cmd).toContain("Read,Write"); // Tools are joined with comma
      expect(cmd).toContain("--disallowedTools");
      expect(cmd).toContain("Bash");
    });

    it("should include budget limit when specified", async () => {
      const session = new ClaudeCodeSession();
      const buildCommand = getBuildCommand(session);

      const cmd = buildCommand("claude", {
        cwd: "/test",
        prompt: "hello",
        maxBudgetUsd: 1.5
      });

      expect(cmd).toContain("--max-budget-usd");
      expect(cmd).toContain("1.5");
    });
  });

  describe("getActiveSessions", () => {
    it("should return empty array when no sessions", () => {
      const session = new ClaudeCodeSession();
      expect(session.getActiveSessions()).toEqual([]);
    });
  });

  describe("event emission", () => {
    it("should have event emitter methods", () => {
      const session = new ClaudeCodeSession();
      expect(typeof session.on).toBe("function");
      expect(typeof session.emit).toBe("function");
    });
  });
});

describe("runClaudeCodeSession", () => {
  it("should be a function", () => {
    expect(typeof runClaudeCodeSession).toBe("function");
  });
});
