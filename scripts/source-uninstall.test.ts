import { describe, expect, mock, test } from "bun:test";
import {
  parseUninstallerArgs,
  type UninstallDependencies,
  uninstallFromSource,
} from "./source-uninstall";

describe("parseUninstallerArgs", () => {
  test("recognizes help flags without side effects", () => {
    expect(parseUninstallerArgs(["--help"])).toEqual({ mode: "help" });
    expect(parseUninstallerArgs(["-h"])).toEqual({ mode: "help" });
  });

  test("rejects unknown flags", () => {
    expect(() => parseUninstallerArgs(["--wat"])).toThrow('Unknown argument "--wat"');
  });
});

describe("uninstallFromSource", () => {
  test("stops and removes the systemd service, unlinks the CLI, and cleans logs on Linux", async () => {
    const commands: string[][] = [];
    const getProcessCwd = mock(async () => null);
    const killProcess = mock(async () => undefined);
    const listProcesses = mock(async () => []);
    const removeFile = mock(async () => undefined);
    const removeDir = mock(async () => undefined);
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });

    await uninstallFromSource({
      platform: "linux",
      dependencies: {
        removeDir,
        removeFile,
        run,
        killProcess,
        listProcesses,
        getProcessCwd,
      } satisfies Partial<UninstallDependencies>,
      homeDir: "/home/marcelo",
      workspaceDir: "/repo",
    });

    expect(commands).toEqual([
      ["systemctl", "--user", "disable", "--now", "aop-local-server.service"],
      ["systemctl", "--user", "daemon-reload"],
      ["bun", "unlink"],
    ]);
    expect(removeFile).toHaveBeenCalledWith(
      "/home/marcelo/.config/systemd/user/aop-local-server.service",
    );
    expect(removeDir).toHaveBeenCalledWith("/home/marcelo/.aop/logs");
  });

  test("unloads and removes the launch agent, unlinks the CLI, and cleans logs on macOS", async () => {
    const commands: string[][] = [];
    const getProcessCwd = mock(async () => null);
    const killProcess = mock(async () => undefined);
    const listProcesses = mock(async () => []);
    const removeFile = mock(async () => undefined);
    const removeDir = mock(async () => undefined);
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });

    await uninstallFromSource({
      platform: "darwin",
      dependencies: {
        removeDir,
        removeFile,
        run,
        killProcess,
        listProcesses,
        getProcessCwd,
      } satisfies Partial<UninstallDependencies>,
      homeDir: "/Users/marcelo",
      workspaceDir: "/repo",
    });

    expect(commands).toEqual([
      ["launchctl", "unload", "/Users/marcelo/Library/LaunchAgents/com.aop.local-server.plist"],
      ["bun", "unlink"],
    ]);
    expect(removeFile).toHaveBeenCalledWith(
      "/Users/marcelo/Library/LaunchAgents/com.aop.local-server.plist",
    );
    expect(removeDir).toHaveBeenCalledWith("/Users/marcelo/.aop/logs");
  });

  test("kills stray bun processes tied to the current AOP workspace before unlinking", async () => {
    const commands: string[][] = [];
    const removeFile = mock(async () => undefined);
    const removeDir = mock(async () => undefined);
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });
    const killProcess = mock(async () => undefined);
    const listProcesses = mock(async () => [
      { pid: process.pid, command: "bun scripts/source-uninstall.ts" },
      { pid: 1001, command: "bun run ./scripts/dev.ts --no-dashboard" },
      { pid: 1002, command: "bun run --watch ./src/run.ts" },
      { pid: 1003, command: "bun run ./dev.ts" },
      { pid: 1004, command: "bun run ./some-other-project.ts" },
      { pid: 1005, command: "node server.js" },
    ]);
    const getProcessCwd = mock(async (pid: number) => {
      switch (pid) {
        case process.pid:
          return "/repo";
        case 1001:
          return "/repo";
        case 1002:
          return "/repo/apps/local-server";
        case 1003:
          return "/repo/apps/dashboard";
        case 1004:
          return "/tmp/other-project";
        default:
          return null;
      }
    });

    await uninstallFromSource({
      platform: "linux",
      dependencies: {
        removeDir,
        removeFile,
        run,
        killProcess,
        listProcesses,
        getProcessCwd,
      } satisfies Partial<UninstallDependencies>,
      homeDir: "/home/marcelo",
      workspaceDir: "/repo",
    });

    expect(killProcess.mock.calls.map(([pid]) => pid)).toEqual([1001, 1002, 1003]);
    expect(commands).toEqual([
      ["systemctl", "--user", "disable", "--now", "aop-local-server.service"],
      ["systemctl", "--user", "daemon-reload"],
      ["bun", "unlink"],
    ]);
  });
});
