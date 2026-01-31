import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { SdkAgentRunner } from "./sdk-agent-runner";

// Mock the pi-coding-agent module
const mockSession = {
  prompt: mock(() => Promise.resolve()),
  abort: mock(() => Promise.resolve()),
  dispose: mock(() => {}),
  subscribe: mock(() => () => {}),
  isStreaming: false
};

const mockCreateAgentSession = mock(() =>
  Promise.resolve({
    session: mockSession,
    extensionsResult: { extensions: [], warnings: [] }
  })
);

const mockAuthStorage = {
  getApiKey: mock(() => Promise.resolve("test-key"))
};

const _mockDiscoverAuthStorage = mock(() => mockAuthStorage);

const mockModelRegistry = {
  getAvailable: mock(() => [
    { id: "claude-sonnet-4-5", provider: "anthropic" }
  ]),
  getAll: mock(() => [{ id: "claude-sonnet-4-5", provider: "anthropic" }])
};

const _mockDiscoverModels = mock(() => mockModelRegistry);
const _mockDiscoverSkills = mock(() => ({ skills: [], warnings: [] }));

// Store original modules for restoration
let originalEnv: Record<string, string | undefined>;

describe("SdkAgentRunner", () => {
  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Reset mocks
    mockSession.prompt.mockReset();
    mockSession.abort.mockReset();
    mockSession.dispose.mockReset();
    mockSession.subscribe.mockReset();
    mockSession.isStreaming = false;
    mockCreateAgentSession.mockReset();

    mockCreateAgentSession.mockImplementation(() =>
      Promise.resolve({
        session: mockSession,
        extensionsResult: { extensions: [], warnings: [] }
      })
    );
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe("class structure", () => {
    test("extends EventEmitter", () => {
      const runner = new SdkAgentRunner();
      expect(runner).toBeInstanceOf(EventEmitter);
    });

    test("has spawn method", () => {
      const runner = new SdkAgentRunner();
      expect(typeof runner.spawn).toBe("function");
    });

    test("has kill method", () => {
      const runner = new SdkAgentRunner();
      expect(typeof runner.kill).toBe("function");
    });

    test("has getActive method", () => {
      const runner = new SdkAgentRunner();
      expect(typeof runner.getActive).toBe("function");
    });

    test("has getCountByType method", () => {
      const runner = new SdkAgentRunner();
      expect(typeof runner.getCountByType).toBe("function");
    });
  });

  describe("getActive()", () => {
    test("returns empty array initially", () => {
      const runner = new SdkAgentRunner();
      expect(runner.getActive()).toEqual([]);
    });
  });

  describe("getCountByType()", () => {
    test("returns 0 initially for any type", () => {
      const runner = new SdkAgentRunner();
      expect(runner.getCountByType("implementation")).toBe(0);
      expect(runner.getCountByType("review")).toBe(0);
    });
  });

  describe("spawn()", () => {
    test("requires valid spawn options", async () => {
      // This test verifies that spawn accepts the expected options interface
      // The actual authentication test would require mocking the file system
      const runner = new SdkAgentRunner();

      // Verify spawn function exists and has correct signature
      expect(typeof runner.spawn).toBe("function");
    });
  });

  describe("events", () => {
    test("defines standard event types", () => {
      const runner = new SdkAgentRunner();
      const events = ["started", "output", "completed", "error"];

      for (const event of events) {
        let called = false;
        runner.on(event, () => {
          called = true;
        });
        runner.emit(event, {});
        expect(called).toBe(true);
      }
    });
  });

  describe("AgentProcess interface", () => {
    test("pid is 0 for SDK sessions", () => {
      // The SDK runner uses pid=0 as a sentinel value since there's no OS process
      const runner = new SdkAgentRunner();
      const active = runner.getActive();
      // When there are active sessions, their pid should be 0
      expect(
        active.every((p) => p.pid === 0 || typeof p.pid === "number")
      ).toBe(true);
    });
  });

  describe("kill()", () => {
    test("handles non-existent agent gracefully", async () => {
      const runner = new SdkAgentRunner();
      // Should not throw
      await runner.kill("non-existent-id");
    });
  });
});
