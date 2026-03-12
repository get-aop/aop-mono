import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { LLMProvider } from "../types";
import { ClaudeCodeProvider, createWatchdog } from "./claude-code";

const createMockReadableStream = (chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
};

interface MockProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: string;
  stdin: string;
  exited: Promise<number>;
  kill: () => void;
  unref: () => void;
}

describe("ClaudeCodeProvider", () => {
  test("implements LLMProvider interface", () => {
    const provider: LLMProvider = new ClaudeCodeProvider();
    expect(provider.name).toBe("claude-code");
    expect(typeof provider.run).toBe("function");
  });

  test("has readonly name property", () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.name).toBe("claude-code");
  });
});

describe("buildCommand", () => {
  test("builds base command with required flags", () => {
    const provider = new ClaudeCodeProvider();
    const cmd = provider.buildCommand({ prompt: "test prompt" });
    expect(cmd).toEqual([
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "test prompt",
    ]);
  });

  test("adds --resume flag when resumeSessionId provided", () => {
    const provider = new ClaudeCodeProvider();
    const cmd = provider.buildCommand({
      prompt: "test prompt",
      resumeSessionId: "session-123",
    });
    expect(cmd).toEqual([
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--resume",
      "session-123",
      "test prompt",
    ]);
  });

  test("adds --settings flag when fastMode is true", () => {
    const provider = new ClaudeCodeProvider();
    const cmd = provider.buildCommand({
      prompt: "test prompt",
      fastMode: true,
    });
    expect(cmd).toEqual([
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--settings",
      '{"fastMode":true}',
      "test prompt",
    ]);
  });

  test("does not add --settings flag when fastMode is false", () => {
    const provider = new ClaudeCodeProvider();
    const cmd = provider.buildCommand({
      prompt: "test prompt",
      fastMode: false,
    });
    expect(cmd).toEqual([
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "test prompt",
    ]);
  });

  test("does not add --settings flag when fastMode is undefined", () => {
    const provider = new ClaudeCodeProvider();
    const cmd = provider.buildCommand({
      prompt: "test prompt",
    });
    expect(cmd).not.toContain("--settings");
  });

  test("adds model and effort flags when provided", () => {
    const provider = new ClaudeCodeProvider();
    const cmd = provider.buildCommand({
      prompt: "test prompt",
      model: "claude-sonnet-4-6",
      reasoningEffort: "max",
    });
    expect(cmd).toEqual([
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--model",
      "claude-sonnet-4-6",
      "--effort",
      "max",
      "test prompt",
    ]);
  });
});

describe("parseStreamLine", () => {
  test("parses valid JSON line and returns parsed object", () => {
    const provider = new ClaudeCodeProvider();
    const result = provider.parseStreamLine('{"type":"text","content":"hello"}');
    expect(result).toEqual({ type: "text", content: "hello" });
  });

  test("returns null for invalid JSON", () => {
    const provider = new ClaudeCodeProvider();
    const result = provider.parseStreamLine("not json");
    expect(result).toBeNull();
  });

  test("returns null for empty line", () => {
    const provider = new ClaudeCodeProvider();
    const result = provider.parseStreamLine("");
    expect(result).toBeNull();
  });

  test("returns null for whitespace-only line", () => {
    const provider = new ClaudeCodeProvider();
    const result = provider.parseStreamLine("   ");
    expect(result).toBeNull();
  });
});

describe("extractSessionId", () => {
  test("extracts session_id from message", () => {
    const provider = new ClaudeCodeProvider();
    const sessionId = provider.extractSessionId({ session_id: "abc-123", type: "system" });
    expect(sessionId).toBe("abc-123");
  });

  test("returns undefined when no session_id", () => {
    const provider = new ClaudeCodeProvider();
    const sessionId = provider.extractSessionId({ type: "text" });
    expect(sessionId).toBeUndefined();
  });
});

describe("createWatchdog", () => {
  test("does not trigger callback when activity is within timeout", async () => {
    let onTimeoutCalled = false;
    const lastActivity = Date.now();

    const watchdog = createWatchdog(
      1000,
      () => lastActivity,
      () => {
        onTimeoutCalled = true;
      },
      50,
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    watchdog.stop();
    expect(onTimeoutCalled).toBe(false);
  });

  test("triggers callback when inactivity exceeds timeout", async () => {
    let onTimeoutCalled = false;
    const startTime = Date.now();

    createWatchdog(
      1000,
      () => startTime - 2000,
      () => {
        onTimeoutCalled = true;
      },
      50,
    );

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onTimeoutCalled).toBe(true);
  });

  test("stop() clears the interval and prevents callback", async () => {
    let onTimeoutCalled = false;
    const startTime = Date.now();

    const watchdog = createWatchdog(
      1000,
      () => startTime - 2000,
      () => {
        onTimeoutCalled = true;
      },
      50,
    );

    watchdog.stop();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onTimeoutCalled).toBe(false);
  });
});

describe("run", () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    spawnSpy?.mockRestore();
  });

  const createMockProcess = (chunks: string[], exitCode = 0): MockProcess => ({
    pid: 12345,
    stdout: createMockReadableStream(chunks),
    stderr: "inherit",
    stdin: "inherit",
    exited: Promise.resolve(exitCode),
    kill: mock(() => {}),
    unref: mock(() => {}),
  });

  test("processes stream and returns exit code and pid", async () => {
    const mockProc = createMockProcess(['{"type":"text"}\n']);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    const result = await provider.run({ prompt: "test" });

    expect(result.exitCode).toBe(0);
    expect(result.pid).toBe(12345);
    expect(result.timedOut).toBeFalsy();
  });

  test("calls onSpawn callback with pid", async () => {
    const mockProc = createMockProcess(['{"type":"text"}\n']);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    let spawnedPid: number | undefined;
    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      onSpawn: (pid) => {
        spawnedPid = pid;
      },
    });

    expect(spawnedPid).toBe(12345);
  });

  test("passes env vars to spawn", async () => {
    const mockProc = createMockProcess([]);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      env: { AOP_TASK_ID: "task-1", AOP_STEP_ID: "step-1" },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const env = spawnArgs.env as Record<string, string>;
    expect(env.AOP_TASK_ID).toBe("task-1");
    expect(env.AOP_STEP_ID).toBe("step-1");
  });

  test("sets env with PATH when no env option provided", async () => {
    const mockProc = createMockProcess([]);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    await provider.run({ prompt: "test" });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const env = spawnArgs.env as Record<string, string>;
    expect(env.PATH).toContain("/usr/local/bin");
  });

  test("extracts session ID from stream", async () => {
    const mockProc = createMockProcess(['{"session_id":"sess-abc-123","type":"system"}\n']);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    const result = await provider.run({ prompt: "test" });

    expect(result.sessionId).toBe("sess-abc-123");
  });

  test("calls onOutput callback for each parsed JSON line", async () => {
    const mockProc = createMockProcess([
      '{"type":"text","content":"hello"}\n',
      '{"type":"text","content":"world"}\n',
    ]);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const outputs: Record<string, unknown>[] = [];
    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      onOutput: (data) => outputs.push(data),
    });

    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toEqual({ type: "text", content: "hello" });
    expect(outputs[1]).toEqual({ type: "text", content: "world" });
  });

  test("calls onActivity callback on stream data", async () => {
    const mockProc = createMockProcess(['{"type":"text"}\n', '{"type":"text"}\n']);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    let activityCount = 0;
    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      onActivity: () => activityCount++,
    });

    expect(activityCount).toBeGreaterThan(0);
  });

  test("handles non-zero exit code", async () => {
    const mockProc = createMockProcess([], 1);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    const result = await provider.run({ prompt: "test" });

    expect(result.exitCode).toBe(1);
  });

  test("handles partial JSON lines across chunks", async () => {
    const mockProc = createMockProcess(['{"type":', '"text"}\n']);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const outputs: Record<string, unknown>[] = [];
    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      onOutput: (data) => outputs.push(data),
    });

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({ type: "text" });
  });

  test("handles remaining buffer after stream ends", async () => {
    const mockProc = createMockProcess(['{"type":"final"}']);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const outputs: Record<string, unknown>[] = [];
    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      onOutput: (data) => outputs.push(data),
    });

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({ type: "final" });
  });

  test("skips invalid JSON lines", async () => {
    const mockProc = createMockProcess(['not json\n{"type":"valid"}\n']);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const outputs: Record<string, unknown>[] = [];
    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      onOutput: (data) => outputs.push(data),
    });

    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({ type: "valid" });
  });

  test("passes cwd to spawn", async () => {
    const mockProc = createMockProcess([]);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    await provider.run({ prompt: "test", cwd: "/some/path" });

    expect(spawnSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/some/path" }));
  });

  test("includes raw line in onOutput callback", async () => {
    const mockProc = createMockProcess(['{"type":"text"}\n']);
    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const rawLines: string[] = [];
    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      onOutput: (_, rawLine) => {
        if (rawLine) rawLines.push(rawLine);
      },
    });

    expect(rawLines).toHaveLength(1);
    expect(rawLines[0]).toBe('{"type":"text"}');
  });
});

describe("run with inactivity timeout", () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    spawnSpy?.mockRestore();
  });

  test("does not timeout when stream completes quickly", async () => {
    const mockProc = {
      pid: 12345,
      stdout: createMockReadableStream(['{"type":"done"}\n']),
      stderr: "inherit",
      stdin: "inherit",
      exited: Promise.resolve(0),
      kill: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    const result = await provider.run({ prompt: "test", inactivityTimeoutMs: 10000 });

    expect(result.timedOut).toBeFalsy();
    expect(result.exitCode).toBe(0);
  });
});

describe("run with logFilePath (file-based output)", () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    spawnSpy?.mockRestore();
  });

  test("spawns detached process in file mode", async () => {
    const mockProc = {
      pid: 88888,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spawnArgs.detached).toBe(true);
  });

  test("uses ignore for stdin and stderr in file mode", async () => {
    const mockProc = {
      pid: 88887,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spawnArgs.stdin).toBe("ignore");
    expect(spawnArgs.stderr).toBe("ignore");
  });

  test("calls unref on spawned process in file mode", async () => {
    const mockProc = {
      pid: 88886,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
    });

    expect(mockProc.unref).toHaveBeenCalled();
  });

  test("spawns with stdout as Bun.file when logFilePath provided", async () => {
    const mockProc = {
      pid: 99999,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    const result = await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
    });

    expect(result.exitCode).toBe(0);
    expect(result.pid).toBe(99999);

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spawnArgs.stdout).toBeDefined();
    expect(spawnArgs.stdout).not.toBe("pipe");
  });

  test("calls onSpawn with pid in file mode", async () => {
    const mockProc = {
      pid: 77777,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    let spawnedPid: number | undefined;
    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
      onSpawn: (pid) => {
        spawnedPid = pid;
      },
    });

    expect(spawnedPid).toBe(77777);
  });

  test("passes env vars in file mode", async () => {
    const mockProc = {
      pid: 55555,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
      env: { AOP_TASK_ID: "task-42" },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const env = spawnArgs.env as Record<string, string>;
    expect(env.AOP_TASK_ID).toBe("task-42");
  });

  test("passes cwd to spawn in file mode", async () => {
    const mockProc = {
      pid: 44444,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
      cwd: "/some/work/dir",
    });

    expect(spawnSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/some/work/dir" }));
  });

  test("sets env with PATH when no env option in file mode", async () => {
    const mockProc = {
      pid: 22222,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const env = spawnArgs.env as Record<string, string>;
    expect(env.PATH).toContain("/usr/local/bin");
  });

  test("returns non-zero exit code in file mode", async () => {
    const mockProc = {
      pid: 11111,
      exited: Promise.resolve(1),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    const result = await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
    });

    expect(result.exitCode).toBe(1);
    expect(result.pid).toBe(11111);
  });

  test("does not return sessionId in file mode", async () => {
    const mockProc = {
      pid: 33333,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new ClaudeCodeProvider();
    const result = await provider.run({
      prompt: "test",
      logFilePath: "/tmp/test-log.jsonl",
    });

    expect(result.sessionId).toBeUndefined();
  });
});
