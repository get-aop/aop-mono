#!/usr/bin/env bun

import { readlink, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type SupportedPlatform = "darwin" | "linux";

type Command = string[];

type RunOptions = {
  allowFailure?: boolean;
  cwd?: string;
};

export type UninstallDependencies = {
  getProcessCwd: (pid: number, platform: SupportedPlatform) => Promise<string | null>;
  killProcess: (pid: number) => Promise<void>;
  listProcesses: () => Promise<RunningProcess[]>;
  removeDir: (path: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  run: (command: Command, options?: RunOptions) => Promise<void>;
};

type RunningProcess = {
  pid: number;
  command: string;
};

type UninstallOptions = {
  dependencies?: Partial<UninstallDependencies>;
  homeDir?: string;
  platform?: SupportedPlatform;
  workspaceDir?: string;
};

type UninstallerArgs = {
  mode: "help" | "uninstall";
};

const LAUNCHD_SERVICE_NAME = "com.aop.local-server";
const SYSTEMD_SERVICE_NAME = "aop-local-server";
const UNINSTALL_USAGE = `Usage: ./uninstall

Removes the source-based local AOP setup for the current user:
- stops and removes the local-server user service
- unlinks the global aop CLI registration
- removes ~/.aop/logs
`;

export const parseUninstallerArgs = (args: string[]): UninstallerArgs => {
  if (args.length === 0) {
    return { mode: "uninstall" };
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { mode: "help" };
  }

  throw new Error(`Unknown argument "${args[0]}"`);
};

export const uninstallFromSource = async (options: UninstallOptions = {}): Promise<void> => {
  const platform = options.platform ?? detectPlatform();
  const workspaceDir = options.workspaceDir ?? resolve(import.meta.dirname, "..");
  const homeDir = options.homeDir ?? homedir();
  const dependencies = createDependencies(options.dependencies);

  const logsDir = join(homeDir, ".aop", "logs");

  if (platform === "darwin") {
    await uninstallLaunchAgent({ dependencies, homeDir });
  } else {
    await uninstallSystemdUnit({ dependencies, homeDir });
  }

  await cleanupAopBunProcesses({
    dependencies,
    platform,
    workspaceDir,
  });
  await dependencies.run(["bun", "unlink"], { cwd: workspaceDir, allowFailure: true });
  await dependencies.removeDir(logsDir);
};

export const runSourceUninstall = async (args = process.argv.slice(2)): Promise<void> => {
  const parsed = parseUninstallerArgs(args);
  if (parsed.mode === "help") {
    process.stdout.write(UNINSTALL_USAGE);
    return;
  }

  await uninstallFromSource();
  process.stdout.write(
    "AOP source uninstall complete.\nThe local server user service has been removed and the global `aop` link was cleaned up.\n",
  );
};

const uninstallLaunchAgent = async ({
  dependencies,
  homeDir,
}: {
  dependencies: UninstallDependencies;
  homeDir: string;
}): Promise<void> => {
  const plistPath = join(homeDir, "Library", "LaunchAgents", `${LAUNCHD_SERVICE_NAME}.plist`);
  await dependencies.run(["launchctl", "unload", plistPath], { allowFailure: true });
  await dependencies.removeFile(plistPath);
};

const uninstallSystemdUnit = async ({
  dependencies,
  homeDir,
}: {
  dependencies: UninstallDependencies;
  homeDir: string;
}): Promise<void> => {
  const unitPath = join(homeDir, ".config", "systemd", "user", `${SYSTEMD_SERVICE_NAME}.service`);
  await dependencies.run(
    ["systemctl", "--user", "disable", "--now", `${SYSTEMD_SERVICE_NAME}.service`],
    {
      allowFailure: true,
    },
  );
  await dependencies.removeFile(unitPath);
  await dependencies.run(["systemctl", "--user", "daemon-reload"], { allowFailure: true });
};

const createDependencies = (
  dependencies: Partial<UninstallDependencies> = {},
): UninstallDependencies => ({
  getProcessCwd: getProcessCwd,
  killProcess: killProcess,
  listProcesses: listProcesses,
  removeDir: removeDir,
  removeFile: removeFile,
  run: runCommand,
  ...dependencies,
});

const detectPlatform = (): SupportedPlatform => {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  throw new Error(
    `Unsupported platform "${process.platform}". Source uninstall supports macOS and Linux.`,
  );
};

const removeDir = async (path: string): Promise<void> => {
  await rm(path, { recursive: true, force: true });
};

const removeFile = async (path: string): Promise<void> => {
  await rm(path, { force: true });
};

const cleanupAopBunProcesses = async ({
  dependencies,
  platform,
  workspaceDir,
}: {
  dependencies: UninstallDependencies;
  platform: SupportedPlatform;
  workspaceDir: string;
}): Promise<void> => {
  const processes = await dependencies.listProcesses();

  for (const processInfo of processes) {
    if (processInfo.pid === process.pid) {
      continue;
    }

    const cwd = await dependencies.getProcessCwd(processInfo.pid, platform);
    if (!isAopBunProcess(processInfo.command, cwd, workspaceDir)) {
      continue;
    }

    await dependencies.killProcess(processInfo.pid);
  }
};

const isAopBunProcess = (command: string, cwd: string | null, workspaceDir: string): boolean => {
  if (!/\bbun(?:\.exe)?\b/.test(command)) {
    return false;
  }

  return (
    command.includes(workspaceDir) ||
    isPathInWorkspace(cwd, workspaceDir) ||
    command.includes("apps/local-server/src/run.ts") ||
    command.includes("./scripts/dev.ts")
  );
};

const isPathInWorkspace = (path: string | null, workspaceDir: string): boolean =>
  Boolean(path) && (path === workspaceDir || path.startsWith(`${workspaceDir}/`));

const listProcesses = async (): Promise<RunningProcess[]> => {
  const proc = Bun.spawn(["ps", "-eo", "pid=,args="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error("Failed to list running processes");
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return [];
      }

      return [
        {
          pid: Number(match[1]),
          command: match[2],
        },
      ];
    });
};

const getProcessCwd = async (pid: number, platform: SupportedPlatform): Promise<string | null> => {
  if (platform === "linux") {
    try {
      return await readlink(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }

  const proc = Bun.spawn(["lsof", "-a", "-d", "cwd", "-p", String(pid), "-Fn"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return null;
  }

  const cwdLine = output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("n"));
  return cwdLine ? cwdLine.slice(1) : null;
};

const killProcess = async (pid: number): Promise<void> => {
  const proc = Bun.spawn(["kill", "-TERM", String(pid)], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;
  if (exitCode === 0) {
    return;
  }

  const forceProc = Bun.spawn(["kill", "-KILL", String(pid)], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const forceExitCode = await forceProc.exited;
  if (forceExitCode !== 0) {
    throw new Error(`Failed to kill process ${pid}`);
  }
};

const runCommand = async (command: Command, options: RunOptions = {}): Promise<void> => {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;
  if (exitCode === 0 || options.allowFailure) {
    return;
  }

  throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
};

if (import.meta.main) {
  await runSourceUninstall();
}
