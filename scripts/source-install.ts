#!/usr/bin/env bun

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type SupportedPlatform = "darwin" | "linux";

type Command = string[];

type RunOptions = {
  allowFailure?: boolean;
  cwd?: string;
};

export type InstallDependencies = {
  chmod: typeof chmod;
  mkdir: typeof mkdir;
  run: (command: Command, options?: RunOptions) => Promise<void>;
  writeFile: typeof writeFile;
};

type ServiceTemplateOptions = {
  bunPath: string;
  logPath: string;
  serviceName: string;
  workspaceDir: string;
};

type InstallOptions = {
  bunPath?: string;
  dependencies?: Partial<InstallDependencies>;
  homeDir?: string;
  platform?: SupportedPlatform;
  workspaceDir?: string;
};

type InstallerArgs = {
  mode: "help" | "install";
};

const LAUNCHD_SERVICE_NAME = "com.aop.local-server";
const SYSTEMD_SERVICE_NAME = "aop-local-server";
const INSTALL_USAGE = `Usage: ./install

Installs AOP from source for the current user:
- bun install --ignore-scripts
- bun link
- bunx openspec init --tools claude
- local-server user service on macOS/Linux
`;

export const buildLaunchdPlist = ({
  bunPath,
  logPath,
  serviceName,
  workspaceDir,
}: ServiceTemplateOptions): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${serviceName}</string>
  <key>WorkingDirectory</key>
  <string>${workspaceDir}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>run</string>
    <string>apps/local-server/src/run.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AOP_LOG_DIR</key>
    <string>${dirname(logPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;

export const buildSystemdUnit = ({
  bunPath,
  logPath,
  serviceName,
  workspaceDir,
}: ServiceTemplateOptions): string => `[Unit]
Description=AOP Local Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${workspaceDir}
ExecStart=${bunPath} run apps/local-server/src/run.ts
Environment=AOP_LOG_DIR=${dirname(logPath)}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
# ${serviceName}
`;

export const installFromSource = async (options: InstallOptions = {}): Promise<void> => {
  const platform = options.platform ?? detectPlatform();
  const workspaceDir = options.workspaceDir ?? resolve(import.meta.dirname, "..");
  const homeDir = options.homeDir ?? homedir();
  const bunPath = options.bunPath ?? process.execPath;
  const dependencies = createDependencies(options.dependencies);

  const logDir = join(homeDir, ".aop", "logs");
  const logPath = join(logDir, "local-server.log");

  await dependencies.mkdir(logDir, { recursive: true });
  await dependencies.run(["bun", "install", "--ignore-scripts"], { cwd: workspaceDir });
  await dependencies.run(["bun", "link"], { cwd: workspaceDir });
  await dependencies.run(["bunx", "openspec", "init", "--tools", "claude"], { cwd: workspaceDir });

  if (platform === "darwin") {
    await installLaunchAgent({ bunPath, dependencies, homeDir, logPath, workspaceDir });
    return;
  }

  await installSystemdUnit({ bunPath, dependencies, homeDir, logPath, workspaceDir });
};

export const parseInstallerArgs = (args: string[]): InstallerArgs => {
  if (args.length === 0) {
    return { mode: "install" };
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { mode: "help" };
  }

  throw new Error(`Unknown argument "${args[0]}"`);
};

export const runSourceInstall = async (args = process.argv.slice(2)): Promise<void> => {
  const parsed = parseInstallerArgs(args);
  if (parsed.mode === "help") {
    process.stdout.write(INSTALL_USAGE);
    return;
  }

  await installFromSource();
  process.stdout.write(
    "AOP source install complete.\nThe local server is running as a user service and the `aop` command is now linked globally.\n",
  );
};

const installLaunchAgent = async ({
  bunPath,
  dependencies,
  homeDir,
  logPath,
  workspaceDir,
}: {
  bunPath: string;
  dependencies: InstallDependencies;
  homeDir: string;
  logPath: string;
  workspaceDir: string;
}): Promise<void> => {
  const agentsDir = join(homeDir, "Library", "LaunchAgents");
  const plistPath = join(agentsDir, `${LAUNCHD_SERVICE_NAME}.plist`);

  await dependencies.mkdir(agentsDir, { recursive: true });
  await dependencies.writeFile(
    plistPath,
    buildLaunchdPlist({
      bunPath,
      logPath,
      serviceName: LAUNCHD_SERVICE_NAME,
      workspaceDir,
    }),
  );
  await dependencies.chmod(plistPath, 0o644);
  await dependencies.run(["launchctl", "unload", plistPath], { allowFailure: true });
  await dependencies.run(["launchctl", "load", "-w", plistPath]);
};

const installSystemdUnit = async ({
  bunPath,
  dependencies,
  homeDir,
  logPath,
  workspaceDir,
}: {
  bunPath: string;
  dependencies: InstallDependencies;
  homeDir: string;
  logPath: string;
  workspaceDir: string;
}): Promise<void> => {
  const systemdDir = join(homeDir, ".config", "systemd", "user");
  const unitPath = join(systemdDir, `${SYSTEMD_SERVICE_NAME}.service`);

  await dependencies.mkdir(systemdDir, { recursive: true });
  await dependencies.writeFile(
    unitPath,
    buildSystemdUnit({
      bunPath,
      logPath,
      serviceName: SYSTEMD_SERVICE_NAME,
      workspaceDir,
    }),
  );
  await dependencies.run(["systemctl", "--user", "daemon-reload"]);
  await dependencies.run([
    "systemctl",
    "--user",
    "enable",
    "--now",
    `${SYSTEMD_SERVICE_NAME}.service`,
  ]);
};

const createDependencies = (
  dependencies: Partial<InstallDependencies> = {},
): InstallDependencies => ({
  chmod,
  mkdir,
  run: runCommand,
  writeFile,
  ...dependencies,
});

const detectPlatform = (): SupportedPlatform => {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  throw new Error(
    `Unsupported platform "${process.platform}". Source install supports macOS and Linux.`,
  );
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
  await runSourceInstall();
}
