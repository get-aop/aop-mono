#!/usr/bin/env bun

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { rm } from "node:fs/promises";

export type SupportedPlatform = "darwin" | "linux";

type Command = string[];

type RunOptions = {
  allowFailure?: boolean;
  cwd?: string;
};

export type UninstallDependencies = {
  removeDir: (path: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  run: (command: Command, options?: RunOptions) => Promise<void>;
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
  await dependencies.run(["systemctl", "--user", "disable", "--now", `${SYSTEMD_SERVICE_NAME}.service`], {
    allowFailure: true,
  });
  await dependencies.removeFile(unitPath);
  await dependencies.run(["systemctl", "--user", "daemon-reload"], { allowFailure: true });
};

const createDependencies = (
  dependencies: Partial<UninstallDependencies> = {},
): UninstallDependencies => ({
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
