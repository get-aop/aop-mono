import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";

// Helper to create a mock Bun.spawn process for raw mode tests
const createMockSpawnProcess = (exitCode = 0) => {
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      const initEvent = JSON.stringify({
        type: "system",
        subtype: "init",
        model: "claude-test"
      });
      controller.enqueue(new TextEncoder().encode(`${initEvent}\n`));
      const resultEvent = JSON.stringify({
        type: "result",
        subtype: "success",
        total_cost_usd: 0.01
      });
      controller.enqueue(new TextEncoder().encode(`${resultEvent}\n`));
      controller.close();
    }
  });

  const stderr = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    }
  });

  return {
    pid: 12345,
    stdin: null,
    stdout,
    stderr,
    exited: Promise.resolve(exitCode),
    exitCode
  };
};

const dirExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
};

const createGitRepo = async (dir: string): Promise<void> => {
  await mkdir(dir, { recursive: true });
  await Bun.$`git -C ${dir} init`.quiet();
  await Bun.$`git -C ${dir} config user.email "test@test.com"`.quiet();
  await Bun.$`git -C ${dir} config user.name "Test User"`.quiet();
  await writeFile(join(dir, "README.md"), "# Test Project");
  await Bun.$`git -C ${dir} add .`.quiet();
  await Bun.$`git -C ${dir} commit -m "initial commit"`.quiet();
};

// Skip slow integration tests on CI - they create many git repos
describe.skipIf(!!process.env.CI)("Global Mode Integration Tests", () => {
  let ctx: IsolatedGlobalDirContext;
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("global-mode-integration");
    tempDir = join(ctx.globalDir, "..");
    originalCwd = process.cwd();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await ctx.cleanup();
  });

  describe("Bootstrap Tests", () => {
    test("first CLI run creates ~/.aop/ structure", async () => {
      expect(ctx.globalDir).toContain(".aop");
      expect(await dirExists(ctx.globalDir)).toBe(true);
      expect(await dirExists(join(ctx.globalDir, "projects"))).toBe(true);
      expect(await dirExists(join(ctx.globalDir, "tasks"))).toBe(true);
      expect(await dirExists(join(ctx.globalDir, "brainstorm"))).toBe(true);
      expect(await dirExists(join(ctx.globalDir, "worktrees"))).toBe(true);
    });

    test("default config.yaml is valid", async () => {
      const mod = await reimportGlobalBootstrap();
      await ctx.run(() => mod.ensureGlobalDir());

      const configPath = join(ctx.globalDir, "config.yaml");
      const content = await Bun.file(configPath).text();
      const config = YAML.parse(content);

      expect(config.version).toBe(1);
      expect(config.defaults).toBeDefined();
      expect(config.defaults.maxConcurrentAgents).toBe(2);
      expect(config.defaults.dashboardPort).toBe(3001);
      expect(config.providers).toBeDefined();
    });

    test("subsequent runs don't recreate existing structure", async () => {
      const mod = await reimportGlobalBootstrap();
      await ctx.run(() => mod.ensureGlobalDir());

      const customConfig = "version: 99\ncustomSetting: true\n";
      await Bun.write(join(ctx.globalDir, "config.yaml"), customConfig);

      await ctx.run(() => mod.ensureGlobalDir());

      const content = await Bun.file(join(ctx.globalDir, "config.yaml")).text();
      expect(content).toBe(customConfig);
    });
  });

  describe("Project Registration Tests", () => {
    test("aop init in git repo creates project file", async () => {
      const repoDir = join(tempDir, "my-project");
      await createGitRepo(repoDir);
      await Bun.$`git -C ${repoDir} remote add origin git@github.com:testuser/my-project.git`.quiet();

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      const result = await ctx.run(() => init.runInitCommand(repoDir));

      expect(result.success).toBe(true);
      expect(result.projectName).toBe("testuser-my-project");

      const projectFile = join(
        ctx.globalDir,
        "projects",
        "testuser-my-project.yaml"
      );
      expect(await fileExists(projectFile)).toBe(true);
    });

    test("project name derived correctly from remote", async () => {
      const repoDir = join(tempDir, "another-repo");
      await createGitRepo(repoDir);
      await Bun.$`git -C ${repoDir} remote add origin https://github.com/org-name/repo-name.git`.quiet();

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      const result = await ctx.run(() => init.runInitCommand(repoDir));

      expect(result.success).toBe(true);
      expect(result.projectName).toBe("org-name-repo-name");
    });

    test("duplicate registration is handled gracefully", async () => {
      const repoDir = join(tempDir, "dup-project");
      await createGitRepo(repoDir);

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      const first = await ctx.run(() => init.runInitCommand(repoDir));
      expect(first.success).toBe(true);

      const second = await ctx.run(() => init.runInitCommand(repoDir));
      expect(second.success).toBe(false);
      expect(second.error).toContain("already registered");
    });

    test("aop projects lists registered projects", async () => {
      const repo1 = join(tempDir, "project-one");
      const repo2 = join(tempDir, "project-two");
      await createGitRepo(repo1);
      await createGitRepo(repo2);

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      await ctx.run(() => init.runInitCommand(repo1));
      await ctx.run(() => init.runInitCommand(repo2));

      const projects = await reimportProjectsCommand();
      const result = await ctx.run(() =>
        projects.runProjectsCommand("list", undefined)
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("project-one");
      expect(result.output).toContain("project-two");
    });
  });

  describe("Path Resolution Tests", () => {
    test("global mode detected when inside registered project", async () => {
      const repoDir = join(tempDir, "global-project");
      await createGitRepo(repoDir);

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      await ctx.run(() => init.runInitCommand(repoDir));

      const pathResolver = await reimportPathResolver();
      const result = await ctx.run(() => pathResolver.resolvePaths(repoDir));

      expect(result).not.toBeNull();
      expect(result!.mode).toBe("global");
      expect(result!.projectName).toBe("global-project");
    });

    test("correct paths returned for global mode", async () => {
      const repoDir = join(tempDir, "global-paths-project");
      await createGitRepo(repoDir);

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      await ctx.run(() => init.runInitCommand(repoDir));

      const pathResolver = await reimportPathResolver();
      const result = await ctx.run(() => pathResolver.resolvePaths(repoDir));

      expect(result!.devsfactoryDir).toBe(
        join(ctx.globalDir, "tasks", "global-paths-project")
      );
      expect(result!.worktreesDir).toBe(
        join(ctx.globalDir, "worktrees", "global-paths-project")
      );
      expect(result!.brainstormDir).toBe(
        join(ctx.globalDir, "brainstorm", "global-paths-project")
      );
      expect(result!.projectRoot).toBe(repoDir);
    });

    test("returns null when not in a registered project", async () => {
      const projectDir = join(tempDir, "unregistered-project");
      await mkdir(projectDir, { recursive: true });

      const pathResolver = await reimportPathResolver();
      const result = await ctx.run(() => pathResolver.resolvePaths(projectDir));

      expect(result).toBeNull();
    });
  });

  describe("Task Creation Tests", () => {
    test("aop create-task runs Claude with correct prompt in global mode", async () => {
      const repoDir = join(tempDir, "task-global-project");
      await createGitRepo(repoDir);

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      await ctx.run(() => init.runInitCommand(repoDir));

      process.chdir(repoDir);

      let capturedArgs: string[] = [];
      let capturedCwd: string | undefined;
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(((
        args: string[],
        options?: { cwd?: string }
      ) => {
        capturedArgs = args;
        capturedCwd = options?.cwd;
        return createMockSpawnProcess();
      }) as unknown as typeof Bun.spawn);

      try {
        const createTask = await reimportCreateTaskCommand();
        const result = await ctx.run(() =>
          createTask.runCreateTaskCommand({
            slug: "global-task",
            raw: true
          })
        );

        expect(result.success).toBe(true);
        expect(mockSpawn).toHaveBeenCalled();

        const promptArg = capturedArgs[capturedArgs.length - 1];
        expect(promptArg).toContain("/create-task");
        expect(promptArg).toContain('--slug "global-task"');
        expect(capturedCwd).toBe(repoDir);
      } finally {
        mockSpawn.mockRestore();
      }
    });

    test("aop create-task passes description to Claude prompt", async () => {
      const repoDir = join(tempDir, "task-desc-project");
      await createGitRepo(repoDir);

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      await ctx.run(() => init.runInitCommand(repoDir));

      process.chdir(repoDir);

      let capturedArgs: string[] = [];
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(((
        args: string[],
        _options?: { cwd?: string }
      ) => {
        capturedArgs = args;
        return createMockSpawnProcess();
      }) as unknown as typeof Bun.spawn);

      try {
        const createTask = await reimportCreateTaskCommand();
        const result = await ctx.run(() =>
          createTask.runCreateTaskCommand({
            description: "Add user authentication",
            slug: "add-auth",
            raw: true
          })
        );

        expect(result.success).toBe(true);

        const promptArg = capturedArgs[capturedArgs.length - 1];
        expect(promptArg).toContain("/create-task");
        expect(promptArg).toContain('--slug "add-auth"');
        expect(promptArg).toContain('"Add user authentication"');
      } finally {
        mockSpawn.mockRestore();
      }
    });
  });

  describe("Run Command Tests", () => {
    test("run command parseRunArgs handles stop flag", async () => {
      const run = await reimportRunCommand();
      const result = run.parseRunArgs(["stop"]);

      expect(result.stop).toBe(true);
    });

    test("run command parseRunArgs handles status flag", async () => {
      const run = await reimportRunCommand();
      const result = run.parseRunArgs(["status"]);

      expect(result.status).toBe(true);
    });

    test("run command parseRunArgs handles help flag", async () => {
      const run = await reimportRunCommand();
      const result = run.parseRunArgs(["--help"]);

      expect(result.help).toBe(true);
    });
  });

  describe("Brainstorm Tests", () => {
    test("brainstorm creates directory in global mode", async () => {
      const repoDir = join(tempDir, "brainstorm-global");
      await createGitRepo(repoDir);

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      await ctx.run(() => init.runInitCommand(repoDir));

      const brainstorm = await reimportBrainstormCommand();
      const result = await ctx.run(() =>
        brainstorm.runBrainstormCommand("brainstorm-global")
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe("global");
      expect(result.brainstormDir).toBe(
        join(ctx.globalDir, "brainstorm", "brainstorm-global")
      );
    });
  });

  describe("Subdirectory Resolution Tests", () => {
    test("subdirectory of global project resolves correctly", async () => {
      const projectDir = join(tempDir, "global-subdir-project");
      const subDir = join(projectDir, "src", "components");
      await createGitRepo(projectDir);
      await mkdir(subDir, { recursive: true });

      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      await ctx.run(() => init.runInitCommand(projectDir));

      const pathResolver = await reimportPathResolver();
      const result = await ctx.run(() => pathResolver.resolvePaths(subDir));

      expect(result).not.toBeNull();
      expect(result!.mode).toBe("global");
      expect(result!.projectRoot).toBe(projectDir);
    });
  });

  describe("End-to-End Workflow Tests", () => {
    test("complete workflow: bootstrap -> init -> create-task", async () => {
      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      expect(await dirExists(ctx.globalDir)).toBe(true);

      const repoDir = join(tempDir, "e2e-project");
      await createGitRepo(repoDir);

      const init = await reimportInitCommand();
      const initResult = await ctx.run(() => init.runInitCommand(repoDir));

      expect(initResult.success).toBe(true);
      expect(initResult.projectName).toBe("e2e-project");

      process.chdir(repoDir);

      let capturedArgs: string[] = [];
      let capturedCwd: string | undefined;
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(((
        args: string[],
        options?: { cwd?: string }
      ) => {
        capturedArgs = args;
        capturedCwd = options?.cwd;
        return createMockSpawnProcess();
      }) as unknown as typeof Bun.spawn);

      try {
        const createTask = await reimportCreateTaskCommand();
        const taskResult = await ctx.run(() =>
          createTask.runCreateTaskCommand({
            slug: "e2e-task",
            raw: true
          })
        );

        expect(taskResult.success).toBe(true);
        expect(mockSpawn).toHaveBeenCalled();

        const promptArg = capturedArgs[capturedArgs.length - 1];
        expect(promptArg).toContain("/create-task");
        expect(promptArg).toContain('--slug "e2e-task"');
        expect(capturedCwd).toBe(repoDir);

        const pathResolver = await reimportPathResolver();
        const paths = await ctx.run(() => pathResolver.resolvePaths(repoDir));

        expect(paths).not.toBeNull();
        expect(paths!.projectName).toBe("e2e-project");
        expect(paths!.mode).toBe("global");
      } finally {
        mockSpawn.mockRestore();
      }
    });

    test("multiple projects can be managed concurrently", async () => {
      const bootstrap = await reimportGlobalBootstrap();
      await ctx.run(() => bootstrap.ensureGlobalDir());

      const init = await reimportInitCommand();
      const createTask = await reimportCreateTaskCommand();
      const projects = await reimportProjectsCommand();

      const projectDirs: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const repoDir = join(tempDir, `concurrent-project-${i}`);
        await createGitRepo(repoDir);
        projectDirs.push(repoDir);

        const initResult = await ctx.run(() => init.runInitCommand(repoDir));
        expect(initResult.success).toBe(true);
      }

      let spawnCallCount = 0;
      const mockSpawn = spyOn(Bun, "spawn").mockImplementation(((
        _args: string[],
        _options?: { cwd?: string }
      ) => {
        spawnCallCount++;
        return createMockSpawnProcess();
      }) as unknown as typeof Bun.spawn);

      try {
        for (let i = 0; i < projectDirs.length; i++) {
          process.chdir(projectDirs[i]!);
          const taskResult = await ctx.run(() =>
            createTask.runCreateTaskCommand({
              slug: `task-for-project-${i + 1}`,
              raw: true
            })
          );
          expect(taskResult.success).toBe(true);
        }

        expect(spawnCallCount).toBe(3);

        const listResult = await ctx.run(() =>
          projects.runProjectsCommand("list", undefined)
        );
        expect(listResult.success).toBe(true);
        expect(listResult.output).toContain("concurrent-project-1");
        expect(listResult.output).toContain("concurrent-project-2");
        expect(listResult.output).toContain("concurrent-project-3");
      } finally {
        mockSpawn.mockRestore();
      }
    });
  });
});

async function reimportGlobalBootstrap() {
  const timestamp = Date.now();
  return await import(`../core/global-bootstrap?t=${timestamp}`);
}

async function reimportPathResolver() {
  const timestamp = Date.now();
  return await import(`../core/path-resolver?t=${timestamp}`);
}

async function reimportInitCommand() {
  const timestamp = Date.now();
  return await import(`../commands/init?t=${timestamp}`);
}

async function reimportProjectsCommand() {
  const timestamp = Date.now();
  return await import(`../commands/projects?t=${timestamp}`);
}

async function reimportRunCommand() {
  const timestamp = Date.now();
  return await import(`../commands/run?t=${timestamp}`);
}

async function reimportCreateTaskCommand() {
  const timestamp = Date.now();
  return await import(`../commands/create-task?t=${timestamp}`);
}

async function reimportBrainstormCommand() {
  const timestamp = Date.now();
  return await import(`../commands/brainstorm?t=${timestamp}`);
}
