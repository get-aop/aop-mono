import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { LLMProvider } from "../types";
import { CodexProvider } from "./codex";

describe("CodexProvider", () => {
  test("implements LLMProvider interface", () => {
    const provider: LLMProvider = new CodexProvider();
    expect(provider.name).toBe("codex");
    expect(typeof provider.run).toBe("function");
  });

  test("has readonly name property", () => {
    const provider = new CodexProvider();
    expect(provider.name).toBe("codex");
  });
});

describe("buildCommand", () => {
  test("builds the non-interactive codex command", () => {
    const provider = new CodexProvider();

    expect(provider.buildCommand({ prompt: "test prompt" })).toEqual([
      "codex",
      "exec",
      "--json",
      "--ephemeral",
      "--dangerously-bypass-approvals-and-sandbox",
      "test prompt",
    ]);
  });

  test("adds model when provided through env override", () => {
    const provider = new CodexProvider();

    expect(provider.buildCommand({ prompt: "test", env: { AOP_CODEX_MODEL: "gpt-5-codex" } })).toEqual([
      "codex",
      "exec",
      "--json",
      "--ephemeral",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5-codex",
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
      pid: 31337,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new CodexProvider();
    const result = await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
    });

    expect(result.exitCode).toBe(0);
    expect(result.pid).toBe(31337);

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(spawnArgs.detached).toBe(true);
    expect(spawnArgs.stdin).toBe("ignore");
  });

  test("uses an isolated CODEX_HOME under AOP_HOME by default", async () => {
    const mockProc = {
      pid: 31337,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new CodexProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
      env: { AOP_HOME: "/tmp/aop-home" },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const env = spawnArgs.env as Record<string, string>;
    expect(env.CODEX_HOME).toBe("/tmp/aop-home/codex-home");
    expect(env.HOME).toBe("/tmp/aop-home/codex-home");
  });

  test("preserves explicit CODEX_HOME override", async () => {
    const mockProc = {
      pid: 31337,
      exited: Promise.resolve(0),
      kill: mock(() => {}),
      unref: mock(() => {}),
    };

    spawnSpy = spyOn(Bun, "spawn").mockReturnValue(
      mockProc as unknown as ReturnType<typeof Bun.spawn>,
    );

    const provider = new CodexProvider();
    await provider.run({
      prompt: "test",
      logFilePath: "/tmp/log.txt",
      env: {
        AOP_HOME: "/tmp/aop-home",
        CODEX_HOME: "/tmp/custom-codex-home",
      },
    });

    const spawnArgs = spawnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    const env = spawnArgs.env as Record<string, string>;
    expect(env.CODEX_HOME).toBe("/tmp/custom-codex-home");
  });
});
