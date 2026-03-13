import { statSync } from "node:fs";
import type { LLMProvider, RunOptions, RunResult } from "../types";
import { buildSpawnEnv } from "./spawn-env";

interface StreamContext {
  sessionId?: string;
  onOutput?: (data: Record<string, unknown>, rawLine?: string) => void;
  onActivity?: () => void;
}

export interface Watchdog {
  stop: () => void;
}

export const createWatchdog = (
  timeoutMs: number,
  getLastActivity: () => number,
  onTimeout: () => void,
  checkIntervalMs = 5000,
): Watchdog => {
  const intervalId = setInterval(() => {
    const elapsed = Date.now() - getLastActivity();
    if (elapsed > timeoutMs) {
      clearInterval(intervalId);
      onTimeout();
    }
  }, checkIntervalMs);

  return { stop: () => clearInterval(intervalId) };
};

export const getFileMtime = (path: string): number => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return Number.NaN;
  }
};

export const createFileActivityTracker = (
  path: string,
  options: {
    getNow?: () => number;
    readMtime?: (path: string) => number;
  } = {},
): (() => number) => {
  const getNow = options.getNow ?? Date.now;
  const readMtime = options.readMtime ?? getFileMtime;
  let lastActivity = getNow();

  return () => {
    const mtime = readMtime(path);
    if (!Number.isNaN(mtime)) {
      lastActivity = mtime;
    }
    return lastActivity;
  };
};

export class ClaudeCodeProvider implements LLMProvider {
  readonly name = "claude-code";

  buildCommand(options: RunOptions): string[] {
    const cmd = [
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

    if (options.resumeSessionId) {
      cmd.push("--resume", options.resumeSessionId);
    }

    if (options.fastMode) {
      cmd.push("--settings", JSON.stringify({ fastMode: true }));
    }

    if (options.model) {
      cmd.push("--model", options.model);
    }

    if (options.reasoningEffort) {
      cmd.push("--effort", options.reasoningEffort);
    }

    cmd.push(options.prompt);
    return cmd;
  }

  parseStreamLine(line: string): Record<string, unknown> | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  extractSessionId(data: Record<string, unknown>): string | undefined {
    const sessionId = data.session_id;
    return typeof sessionId === "string" ? sessionId : undefined;
  }

  async run(options: RunOptions): Promise<RunResult> {
    if (options.logFilePath) {
      return this.runWithFileOutput(options, options.logFilePath);
    }
    return this.runWithPipeOutput(options);
  }

  private async runWithFileOutput(options: RunOptions, logFilePath: string): Promise<RunResult> {
    const spawnEnv = buildSpawnEnv(options.env);

    const proc = Bun.spawn({
      cmd: this.buildCommand(options),
      stdout: Bun.file(logFilePath),
      stderr: "ignore",
      stdin: "ignore",
      cwd: options.cwd,
      detached: true,
      env: spawnEnv,
    });

    proc.unref();

    const pid = proc.pid;
    await options.onSpawn?.(pid);

    let timedOut = false;
    let watchdog: Watchdog | undefined;

    if (options.inactivityTimeoutMs) {
      const getLastActivity = createFileActivityTracker(logFilePath);
      watchdog = createWatchdog(
        options.inactivityTimeoutMs,
        getLastActivity,
        () => {
          timedOut = true;
          proc.kill();
        },
      );
    }

    const exitCode = await proc.exited;
    watchdog?.stop();

    return { exitCode, pid, timedOut };
  }

  private async runWithPipeOutput(options: RunOptions): Promise<RunResult> {
    const spawnEnv = buildSpawnEnv(options.env);

    const proc = Bun.spawn({
      cmd: this.buildCommand(options),
      stdout: "pipe",
      stderr: "inherit",
      stdin: "inherit",
      cwd: options.cwd,
      env: spawnEnv,
    });

    const pid = proc.pid;
    options.onSpawn?.(pid);

    let lastActivity = Date.now();
    let timedOut = false;
    let watchdog: Watchdog | undefined;

    if (options.inactivityTimeoutMs) {
      watchdog = createWatchdog(
        options.inactivityTimeoutMs,
        () => lastActivity,
        () => {
          timedOut = true;
          proc.kill();
        },
      );
    }

    const ctx: StreamContext = {
      onOutput: options.onOutput,
      onActivity: () => {
        lastActivity = Date.now();
        options.onActivity?.();
      },
    };

    await this.processStream(proc.stdout, ctx);
    watchdog?.stop();

    return { exitCode: await proc.exited, pid, sessionId: ctx.sessionId, timedOut };
  }

  private async processStream(
    stdout: ReadableStream<Uint8Array>,
    ctx: StreamContext,
  ): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      ctx.onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      processLines(lines, ctx, this.parseStreamLine);
    }

    if (buffer.trim()) {
      processLines([buffer], ctx, this.parseStreamLine);
    }
  }
}

const processData = (data: Record<string, unknown>, rawLine: string, ctx: StreamContext): void => {
  const sessionId = data.session_id;
  if (typeof sessionId === "string") {
    ctx.sessionId = sessionId;
  }
  ctx.onOutput?.(data, rawLine);
};

const processLines = (
  lines: string[],
  ctx: StreamContext,
  parseStreamLine: (line: string) => Record<string, unknown> | null,
): void => {
  for (const line of lines) {
    const data = parseStreamLine(line);
    if (data) processData(data, line, ctx);
  }
};
