import { describe, expect, mock, test } from "bun:test";
import {
  buildLaunchdPlist,
  buildSystemdUnit,
  type InstallDependencies,
  installFromSource,
  parseInstallerArgs,
} from "./source-install";

describe("parseInstallerArgs", () => {
  test("recognizes help flags without side effects", () => {
    expect(parseInstallerArgs(["--help"])).toEqual({ mode: "help" });
    expect(parseInstallerArgs(["-h"])).toEqual({ mode: "help" });
  });

  test("rejects unknown flags", () => {
    expect(() => parseInstallerArgs(["--wat"])).toThrow('Unknown argument "--wat"');
  });
});

describe("buildLaunchdPlist", () => {
  test("renders a launch agent that runs the local server from source", () => {
    const plist = buildLaunchdPlist({
      bunPath: "/opt/homebrew/bin/bun",
      logPath: "/Users/marcelo/.aop/logs/local-server.log",
      serviceName: "com.aop.local-server",
      workspaceDir: "/Users/marcelo/src/aop-mono/aop",
    });

    expect(plist).toContain("<string>/opt/homebrew/bin/bun</string>");
    expect(plist).toContain("<string>apps/local-server/src/run.ts</string>");
    expect(plist).toContain("<string>/Users/marcelo/src/aop-mono/aop</string>");
    expect(plist).toContain("<string>/Users/marcelo/.aop/logs/local-server.log</string>");
  });
});

describe("buildSystemdUnit", () => {
  test("renders a user service that runs the local server from source", () => {
    const unit = buildSystemdUnit({
      bunPath: "/home/marcelo/.bun/bin/bun",
      logPath: "/home/marcelo/.aop/logs/local-server.log",
      serviceName: "aop-local-server",
      workspaceDir: "/home/marcelo/src/aop-mono/aop",
    });

    expect(unit).toContain("Description=AOP Local Server");
    expect(unit).toContain("WorkingDirectory=/home/marcelo/src/aop-mono/aop");
    expect(unit).toContain("ExecStart=/home/marcelo/.bun/bin/bun run apps/local-server/src/run.ts");
    expect(unit).toContain("Environment=AOP_LOG_DIR=/home/marcelo/.aop/logs");
  });
});

describe("installFromSource", () => {
  test("installs dependencies, links the CLI, writes a systemd unit, and starts it on Linux", async () => {
    const commands: string[][] = [];
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });
    const writeFile = mock(async () => undefined);
    const mkdir = mock(async () => undefined);
    const chmod = mock(async () => undefined);

    await installFromSource({
      platform: "linux",
      dependencies: {
        chmod,
        mkdir,
        run,
        writeFile,
      } satisfies Partial<InstallDependencies>,
      homeDir: "/home/marcelo",
      bunPath: "/home/marcelo/.bun/bin/bun",
      workspaceDir: "/repo/aop",
    });

    expect(commands).toEqual([
      ["bun", "install", "--ignore-scripts"],
      ["bun", "link"],
      ["bunx", "@fission-ai/openspec", "init", "--tools", "claude"],
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "aop-local-server.service"],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      "/home/marcelo/.config/systemd/user/aop-local-server.service",
      expect.stringContaining(
        "ExecStart=/home/marcelo/.bun/bin/bun run apps/local-server/src/run.ts",
      ),
    );
    expect(chmod).toHaveBeenCalledTimes(0);
    expect(mkdir).toHaveBeenCalled();
  });

  test("installs dependencies, links the CLI, writes a launch agent, and loads it on macOS", async () => {
    const commands: string[][] = [];
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });
    const writeFile = mock(async () => undefined);
    const mkdir = mock(async () => undefined);
    const chmod = mock(async () => undefined);

    await installFromSource({
      platform: "darwin",
      dependencies: {
        chmod,
        mkdir,
        run,
        writeFile,
      } satisfies Partial<InstallDependencies>,
      homeDir: "/Users/marcelo",
      bunPath: "/opt/homebrew/bin/bun",
      workspaceDir: "/repo/aop",
    });

    expect(commands).toEqual([
      ["bun", "install", "--ignore-scripts"],
      ["bun", "link"],
      ["bunx", "@fission-ai/openspec", "init", "--tools", "claude"],
      ["launchctl", "unload", "/Users/marcelo/Library/LaunchAgents/com.aop.local-server.plist"],
      ["launchctl", "load", "-w", "/Users/marcelo/Library/LaunchAgents/com.aop.local-server.plist"],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      "/Users/marcelo/Library/LaunchAgents/com.aop.local-server.plist",
      expect.stringContaining("<string>/opt/homebrew/bin/bun</string>"),
    );
    expect(chmod).toHaveBeenCalledWith(
      "/Users/marcelo/Library/LaunchAgents/com.aop.local-server.plist",
      0o644,
    );
    expect(mkdir).toHaveBeenCalled();
  });
});
