import type { LLMProvider, RunOptions, RunResult } from "../types";
import { createWatchdog, getFileMtime, type Watchdog } from "./claude-code";

export class OpenCodeProvider implements LLMProvider {
  readonly name = "opencode";
  readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  buildCommand(options: RunOptions): string[] {
    return ["opencode", "run", "--model", this.model, "--format", "json", options.prompt];
  }

  async run(options: RunOptions): Promise<RunResult> {
    const spawnEnv = options.env ? { ...process.env, ...options.env } : undefined;

    const proc = Bun.spawn({
      cmd: this.buildCommand(options),
      stdout: options.logFilePath ? Bun.file(options.logFilePath) : "ignore",
      stderr: "ignore",
      stdin: "ignore",
      cwd: options.cwd,
      detached: true,
      ...(spawnEnv && { env: spawnEnv }),
    });

    proc.unref();

    const pid = proc.pid;
    await options.onSpawn?.(pid);

    let timedOut = false;
    let watchdog: Watchdog | undefined;

    const logPath = options.logFilePath;
    if (options.inactivityTimeoutMs && logPath) {
      watchdog = createWatchdog(
        options.inactivityTimeoutMs,
        () => getFileMtime(logPath),
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
}
