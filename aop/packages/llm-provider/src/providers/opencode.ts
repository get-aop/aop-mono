import type { LLMProvider, RunOptions, RunResult } from "../types";
import { createWatchdog, getFileMtime, type Watchdog } from "./claude-code";

// TODO: we need better model/variants, this is a hack
const ALLOWED_VARIANTS = ["low", "medium", "high", "xhigh"];

export class OpenCodeProvider implements LLMProvider {
  readonly name = "opencode";
  readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  buildCommand(options: RunOptions): string[] {
    const cmd = ["opencode", "run", "--model", this.model, "--format", "json", options.prompt];
    attachVariant(cmd, this.model);
    return cmd;
  }

  async run(options: RunOptions): Promise<RunResult> {
    const spawnEnv = options.env ? { ...process.env, ...options.env } : {};
    spawnEnv.OPENCODE_PERMISSION = '{"*":"allow"}';

    const proc = Bun.spawn({
      cmd: this.buildCommand(options),
      stdout: options.logFilePath ? Bun.file(options.logFilePath) : "ignore",
      stderr: options.logFilePath ? Bun.file(options.logFilePath) : "ignore",
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

const attachVariant = (cmd: string[], model: string): void => {
  const maybeVariant = model.split("/")[-1] ?? "";

  if (ALLOWED_VARIANTS.includes(maybeVariant)) {
    cmd.push("--variant", maybeVariant);
  }
};
