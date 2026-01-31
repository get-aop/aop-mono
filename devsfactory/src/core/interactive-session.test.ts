import { describe, expect, it } from "bun:test";
import { createTestIOHandler } from "./interactive-io-handler";
import { InteractiveSession } from "./interactive-session";

// Unit tests for InteractiveSession creation and configuration
// Full integration tests require actual API access

describe("InteractiveSession", () => {
  it("should create session with required options", () => {
    const ioHandler = createTestIOHandler();

    const session = new InteractiveSession({
      cwd: "/test",
      ioHandler
    });

    expect(session).toBeInstanceOf(InteractiveSession);
  });

  it("should accept optional configuration", () => {
    const ioHandler = createTestIOHandler();

    const session = new InteractiveSession({
      cwd: "/test",
      ioHandler,
      systemPrompt: "You are a helpful assistant",
      model: "claude-3-5-sonnet-20241022",
      maxTurns: 10,
      debug: true
    });

    expect(session).toBeInstanceOf(InteractiveSession);
  });

  it("should be an EventEmitter", () => {
    const ioHandler = createTestIOHandler();

    const session = new InteractiveSession({
      cwd: "/test",
      ioHandler
    });

    expect(typeof session.on).toBe("function");
    expect(typeof session.emit).toBe("function");
  });

  it("should have a run method", () => {
    const ioHandler = createTestIOHandler();

    const session = new InteractiveSession({
      cwd: "/test",
      ioHandler
    });

    expect(typeof session.run).toBe("function");
  });
});
