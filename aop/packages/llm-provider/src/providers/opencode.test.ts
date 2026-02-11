import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { LLMProvider } from "../types";
import { OpenCodeProvider } from "./opencode";

describe("OpenCodeProvider", () => {
  test("implements LLMProvider interface", () => {
    const provider: LLMProvider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    expect(provider.name).toBe("opencode");
    expect(typeof provider.run).toBe("function");
  });

  test("has readonly name property", () => {
    const provider = new OpenCodeProvider("openai/gpt-5.3-codex");
    expect(provider.name).toBe("opencode");
  });

  test("stores the model", () => {
    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    expect(provider.model).toBe("opencode/kimi-k2.5-free");
  });
});

describe("buildCommand", () => {
  test("builds command for opencode/kimi-k2.5-free", () => {
    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    const cmd = provider.buildCommand({
      prompt: "test prompt",
      logFilePath: "/tmp/log.txt",
    });
    expect(cmd).toEqual([
      "opencode",
      "run",
      "--model",
      "opencode/kimi-k2.5-free",
      "--format",
      "json",
      "test prompt",
    ]);
  });

  test("builds command for openai/gpt-5.3-codex", () => {
    const provider = new OpenCodeProvider("openai/gpt-5.3-codex");
    const cmd = provider.buildCommand({
      prompt: "do something",
      logFilePath: "/tmp/out.txt",
    });
    expect(cmd).toEqual([
      "opencode",
      "run",
      "--model",
      "openai/gpt-5.3-codex",
      "--format",
      "json",
      "do something",
    ]);
  });

  test("builds same command with or without logFilePath", () => {
    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    const cmd = provider.buildCommand({ prompt: "test" });
    expect(cmd).toEqual([
      "opencode",
      "run",
      "--model",
      "opencode/kimi-k2.5-free",
      "--format",
      "json",
      "test",
    ]);
  });
});

describe("run", () => {
  let spawnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    spawnSpy?.mockRestore();
  });

  test("spawns detached process with file output", async () => {
    const mockProc = {
      pid: 12345,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    const result = await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
    });

    expect(result.exitCode).toBe(0);
    expect(result.pid).toBe(12345);

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spawnArgs.detached).toBe(true);
    expect(spawnArgs.stdin).toBe("ignore");
    expect(spawnArgs.stderr).toBeInstanceOf(Bun.file("/tmp/log.txt").constructor);
  });

  test("calls unref on spawned process", async () => {
    const mockProc = {
      pid: 12345,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    await provider.run({ prompt: "test", logFilePath: "/tmp/log.txt" });

    expect(mockProc.unref).toHaveBeenCalled();
  });

  test("calls onSpawn callback with pid", async () => {
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
    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
      onSpawn: (pid) => {
        spawnedPid = pid;
      },
    });

    expect(spawnedPid).toBe(77777);
  });

  test("merges env vars with process.env", async () => {
    const mockProc = {
      pid: 55555,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
      env: { AOP_TASK_ID: "task-42" },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const env = spawnArgs.env as Record<string, string>;
    expect(env.AOP_TASK_ID).toBe("task-42");
  });

  test("set OPENCODE_PERMISSION env when no env option provided", async () => {
    const mockProc = {
      pid: 22222,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    await provider.run({ prompt: "test", logFilePath: "/tmp/log.txt" });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((spawnArgs.env as Record<string, string>).OPENCODE_PERMISSION).toBe('{"*":"allow"}');
  });

  test("passes cwd to spawn", async () => {
    const mockProc = {
      pid: 44444,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
      cwd: "/some/work/dir",
    });

    expect(spawnSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/some/work/dir" }));
  });

  test("returns non-zero exit code", async () => {
    const mockProc = {
      pid: 11111,
      exited: Promise.resolve(1),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    const result = await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
    });

    expect(result.exitCode).toBe(1);
    expect(result.pid).toBe(11111);
  });

  test("does not return sessionId", async () => {
    const mockProc = {
      pid: 33333,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    const result = await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
    });

    expect(result.sessionId).toBeUndefined();
  });

  test("sets up watchdog when inactivityTimeoutMs is provided", async () => {
    const mockProc = {
      pid: 12345,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new OpenCodeProvider("opencode/kimi-k2.5-free");
    const result = await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
      inactivityTimeoutMs: 30000,
    });

    expect(result.timedOut).toBeFalsy();
    expect(result.exitCode).toBe(0);
  });
});
