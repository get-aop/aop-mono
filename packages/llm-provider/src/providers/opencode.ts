import type { LLMProvider, RunOptions, RunResult } from "../types";
import { createFileActivityTracker, createWatchdog, type Watchdog } from "./claude-code";
import { buildSpawnEnv } from "./spawn-env";

// TODO: we need better model/variants, this is a hack
const ALLOWED_VARIANTS = ["low", "medium", "high", "xhigh"];

export class OpenCodeProvider implements LLMProvider {
  readonly name = "opencode";
  readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  buildCommand(options: RunOptions): string[] {
    const { baseModel, variant } = splitModelAndVariant(this.model);
    const cmd = ["opencode", "run", "--model", baseModel, "--format", "json", options.prompt];
    if (variant) {
      cmd.push("--variant", variant);
    }
    return cmd;
  }

  async run(options: RunOptions): Promise<RunResult> {
    const spawnEnv = buildSpawnEnv(options.env);
    spawnEnv.OPENCODE_PERMISSION = '{"*":"allow"}';

    const proc = Bun.spawn({
      cmd: this.buildCommand(options),
      stdout: options.logFilePath ? Bun.file(options.logFilePath) : "ignore",
      stderr: options.logFilePath ? Bun.file(options.logFilePath) : "ignore",
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

const splitModelAndVariant = (rawModel: string): { baseModel: string; variant?: string } => {
  const parts = rawModel.split("/");
  const lastPart = parts.at(-1) ?? "";
  if (!ALLOWED_VARIANTS.includes(lastPart)) {
    return { baseModel: rawModel };
  }

  const baseModel = parts.slice(0, -1).join("/");
  return { baseModel, variant: lastPart };
};
