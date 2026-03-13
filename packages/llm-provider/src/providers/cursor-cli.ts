import type { LLMProvider, RunOptions, RunResult } from "../types";
import { createFileActivityTracker, createWatchdog, type Watchdog } from "./claude-code";
import { buildSpawnEnv } from "./spawn-env";

export class CursorCliProvider implements LLMProvider {
  readonly name = "cursor-cli";
  readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  buildCommand(options: RunOptions): string[] {
    return [
      "agent",
      "-p",
      "--force",
      "--output-format",
      "stream-json",
      "--model",
      this.model,
      options.prompt,
    ];
  }

  async run(options: RunOptions): Promise<RunResult> {
    const spawnEnv = buildSpawnEnv(options.env);

    const proc = Bun.spawn({
      cmd: this.buildCommand(options),
      stdout: options.logFilePath ? Bun.file(options.logFilePath) : "ignore",
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

    const logPath = options.logFilePath;
    if (options.inactivityTimeoutMs && logPath) {
      const getLastActivity = createFileActivityTracker(logPath);
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
}
