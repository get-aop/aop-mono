import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInstallSuccessMessage,
  buildLaunchdPlist,
  buildSystemdUnit,
  type InstallDependencies,
  installFromSource,
  parseInstallerArgs,
} from "./source-install";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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
  test("renders a launch agent that runs the local server with the bundled dashboard", () => {
    const plist = buildLaunchdPlist({
      bunPath: "/opt/homebrew/bin/bun",
      dashboardStaticPath: "/Users/marcelo/src/aop-mono/apps/dashboard/dist",
      logPath: "/Users/marcelo/.aop/logs/local-server.log",
      localServerPort: "25150",
      localServerUrl: "http://localhost:25150",
      serviceName: "com.aop.local-server",
      workspaceDir: "/Users/marcelo/src/aop-mono/aop",
    });

    expect(plist).toContain("<string>/opt/homebrew/bin/bun</string>");
    expect(plist).toContain("<string>apps/local-server/src/run.ts</string>");
    expect(plist).toContain("<string>/Users/marcelo/src/aop-mono/aop</string>");
    expect(plist).toContain("<string>/Users/marcelo/.aop/logs/local-server.log</string>");
    expect(plist).toContain("<key>NODE_ENV</key>");
    expect(plist).toContain("<string>production</string>");
    expect(plist).toContain("<key>AOP_LOCAL_SERVER_PORT</key>");
    expect(plist).toContain("<string>25150</string>");
    expect(plist).toContain("<key>AOP_LOCAL_SERVER_URL</key>");
    expect(plist).toContain("<string>http://localhost:25150</string>");
    expect(plist).toContain("<key>DASHBOARD_STATIC_PATH</key>");
    expect(plist).toContain("<string>/Users/marcelo/src/aop-mono/apps/dashboard/dist</string>");
  });
});

describe("buildSystemdUnit", () => {
  test("renders a user service that runs the local server with the bundled dashboard", () => {
    const unit = buildSystemdUnit({
      bunPath: "/home/marcelo/.bun/bin/bun",
      dashboardStaticPath: "/home/marcelo/src/aop-mono/apps/dashboard/dist",
      logPath: "/home/marcelo/.aop/logs/local-server.log",
      localServerPort: "25150",
      localServerUrl: "http://localhost:25150",
      serviceName: "aop-local-server",
      workspaceDir: "/home/marcelo/src/aop-mono/aop",
    });

    expect(unit).toContain("Description=AOP Local Server");
    expect(unit).toContain("WorkingDirectory=/home/marcelo/src/aop-mono/aop");
    expect(unit).toContain("ExecStart=/home/marcelo/.bun/bin/bun run apps/local-server/src/run.ts");
    expect(unit).toContain("Environment=NODE_ENV=production");
    expect(unit).toContain("Environment=AOP_LOCAL_SERVER_PORT=25150");
    expect(unit).toContain("Environment=AOP_LOCAL_SERVER_URL=http://localhost:25150");
    expect(unit).toContain("Environment=AOP_LOG_DIR=/home/marcelo/.aop/logs");
    expect(unit).toContain(
      "Environment=DASHBOARD_STATIC_PATH=/home/marcelo/src/aop-mono/apps/dashboard/dist",
    );
  });
});

describe("buildInstallSuccessMessage", () => {
  test("includes the default dashboard url", () => {
    expect(buildInstallSuccessMessage()).toContain("http://localhost:25150");
  });

  test("uses the configured dashboard url when provided", () => {
    expect(buildInstallSuccessMessage("http://localhost:3002")).toContain("http://localhost:3002");
  });
});

describe("installFromSource", () => {
  test("builds the dashboard, links the CLI, writes a systemd unit, and starts it on Linux", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "aop-install-linux-home-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "aop-install-linux-workspace-"));
    tempDirs.push(homeDir, workspaceDir);

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
      homeDir,
      bunPath: "/home/marcelo/.bun/bin/bun",
      workspaceDir,
    });

    expect(commands).toEqual([
      ["bun", "install", "--ignore-scripts"],
      ["bun", "link"],
      ["bun", "run", "build:dashboard"],
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "aop-local-server.service"],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      join(homeDir, ".config", "systemd", "user", "aop-local-server.service"),
      expect.stringContaining(
        "ExecStart=/home/marcelo/.bun/bin/bun run apps/local-server/src/run.ts",
      ),
    );
    expect(chmod).toHaveBeenCalledTimes(0);
    expect(mkdir).toHaveBeenCalled();
  });

  test("builds the dashboard, links the CLI, writes a launch agent, and loads it on macOS", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "aop-install-macos-home-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "aop-install-macos-workspace-"));
    tempDirs.push(homeDir, workspaceDir);

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
      homeDir,
      bunPath: "/opt/homebrew/bin/bun",
      workspaceDir,
    });

    expect(commands).toEqual([
      ["bun", "install", "--ignore-scripts"],
      ["bun", "link"],
      ["bun", "run", "build:dashboard"],
      [
        "launchctl",
        "unload",
        join(homeDir, "Library", "LaunchAgents", "com.aop.local-server.plist"),
      ],
      [
        "launchctl",
        "load",
        "-w",
        join(homeDir, "Library", "LaunchAgents", "com.aop.local-server.plist"),
      ],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      join(homeDir, "Library", "LaunchAgents", "com.aop.local-server.plist"),
      expect.stringContaining("<string>/opt/homebrew/bin/bun</string>"),
    );
    expect(chmod).toHaveBeenCalledWith(
      join(homeDir, "Library", "LaunchAgents", "com.aop.local-server.plist"),
      0o644,
    );
    expect(mkdir).toHaveBeenCalled();
  });

  test("syncs bundled skills into home codex and claude directories and backs up divergent skills", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "aop-install-workspace-"));
    const homeDir = await mkdtemp(join(tmpdir(), "aop-install-home-"));
    tempDirs.push(workspaceDir, homeDir);

    await writeSkill(workspaceDir, ".codex", "aop-create-task", "repo codex create");
    await writeSkill(workspaceDir, ".codex", "systematic-debugging", "repo codex debug");
    await writeSkill(workspaceDir, ".claude", "aop-task-ready", "repo claude ready");
    await writeSkill(workspaceDir, ".claude", "systematic-debugging", "repo claude debug");

    await writeSkill(homeDir, ".codex", "systematic-debugging", "old codex debug");
    await writeSkill(homeDir, ".codex", "create-task", "old codex create");
    await writeSkill(homeDir, ".claude", "systematic-debugging", "repo claude debug");
    await writeSkill(homeDir, ".claude", "task-ready", "old claude ready");

    await installFromSource({
      platform: "linux",
      dependencies: {
        chmod: mock(async () => undefined),
        mkdir: mock(async () => undefined),
        run: mock(async () => undefined),
        writeFile: mock(async () => undefined),
      } satisfies Partial<InstallDependencies>,
      homeDir,
      workspaceDir,
    });

    expect(await readSkill(homeDir, ".codex", "aop-create-task")).toBe("repo codex create");
    expect(await readSkill(homeDir, ".codex", "systematic-debugging")).toBe("repo codex debug");
    expect(await readSkill(homeDir, ".claude", "aop-task-ready")).toBe("repo claude ready");
    expect(await readSkill(homeDir, ".claude", "systematic-debugging")).toBe("repo claude debug");
    expect(await pathExists(join(homeDir, ".codex", "skills", "create-task"))).toBe(false);
    expect(await pathExists(join(homeDir, ".claude", "skills", "task-ready"))).toBe(false);

    const codexBackups = await findBackups(homeDir, "codex", "systematic-debugging");
    expect(codexBackups).toHaveLength(1);
    expect(await readFile(codexBackups[0], "utf8")).toBe("old codex debug");

    const legacyCodexBackups = await findBackups(homeDir, "codex", "create-task");
    expect(legacyCodexBackups).toHaveLength(1);
    expect(await readFile(legacyCodexBackups[0], "utf8")).toBe("old codex create");

    const claudeBackups = await findBackups(homeDir, "claude", "systematic-debugging");
    expect(claudeBackups).toEqual([]);

    const legacyClaudeBackups = await findBackups(homeDir, "claude", "task-ready");
    expect(legacyClaudeBackups).toHaveLength(1);
    expect(await readFile(legacyClaudeBackups[0], "utf8")).toBe("old claude ready");
  });
});

const writeSkill = async (
  rootDir: string,
  toolDir: ".codex" | ".claude",
  skillName: string,
  content: string,
): Promise<void> => {
  const skillDir = join(rootDir, toolDir, "skills", skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content, "utf8");
};

const readSkill = async (
  rootDir: string,
  toolDir: ".codex" | ".claude",
  skillName: string,
): Promise<string> => readFile(join(rootDir, toolDir, "skills", skillName, "SKILL.md"), "utf8");

const findBackups = async (
  homeDir: string,
  toolName: "codex" | "claude",
  skillName: string,
): Promise<string[]> => {
  const backupRoot = join(homeDir, ".aop", "backups", "skills");
  const entries = await readdir(backupRoot, { recursive: true }).catch(() => []);

  return entries
    .filter((entry) => entry.endsWith(`${toolName}/${skillName}/SKILL.md`))
    .map((entry) => join(backupRoot, entry));
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};
