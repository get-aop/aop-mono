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
});
