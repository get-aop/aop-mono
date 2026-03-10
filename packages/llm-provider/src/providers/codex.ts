import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LLMProvider, RunOptions, RunResult } from "../types";
import { createWatchdog, getFileMtime, type Watchdog } from "./claude-code";
import { buildSpawnEnv } from "./spawn-env";

const CODEX_MODEL_ENV = "AOP_CODEX_MODEL";
const USER_CODEX_HOME = join(homedir(), ".codex");
const SEEDED_CODEX_FILES = ["auth.json", "config.toml"] as const;
const SEEDED_HOME_FILES = [".gitconfig"] as const;

export class CodexProvider implements LLMProvider {
  readonly name = "codex";

  buildCommand(options: RunOptions): string[] {
    const cmd = [
      "codex",
      "exec",
      "--json",
      "--ephemeral",
      "--dangerously-bypass-approvals-and-sandbox",
    ];

    const model = options.env?.[CODEX_MODEL_ENV];
    if (model) {
      cmd.push("--model", model);
    }

    cmd.push(options.prompt);
    return cmd;
  }

  async run(options: RunOptions): Promise<RunResult> {
    const spawnEnv = buildSpawnEnv(buildCodexEnv(options.env));

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

const buildCodexEnv = (extraEnv?: Record<string, string>): Record<string, string> => {
  const baseEnv = {
    ...(extraEnv ?? {}),
  };

  if (!baseEnv.CODEX_HOME) {
    const aopHome = baseEnv.AOP_HOME ?? process.env.AOP_HOME ?? join(homedir(), ".aop");
    baseEnv.CODEX_HOME = join(aopHome, "codex-home");
  }

  if (!baseEnv.HOME) {
    baseEnv.HOME = baseEnv.CODEX_HOME;
  }

  mkdirSync(baseEnv.CODEX_HOME, { recursive: true });
  seedCodexHome(baseEnv.CODEX_HOME);
  seedHomeProfile(baseEnv.HOME);
  return baseEnv;
};

const seedCodexHome = (codexHome: string): void => {
  for (const fileName of SEEDED_CODEX_FILES) {
    const sourcePath = join(USER_CODEX_HOME, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    copyFileSync(sourcePath, join(codexHome, fileName));
  }
};

const seedHomeProfile = (homeDir: string): void => {
  mkdirSync(homeDir, { recursive: true });

  for (const fileName of SEEDED_HOME_FILES) {
    const sourcePath = join(homedir(), fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    copyFileSync(sourcePath, join(homeDir, fileName));
  }
};
