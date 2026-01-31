import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";

describe("PathResolver", () => {
  let ctx: IsolatedGlobalDirContext;
  let testRootDir: string;

  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("path-resolver");
    testRootDir = join(ctx.globalDir, "..");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  const runInCtx = <T>(fn: () => T | Promise<T>) => ctx.run(fn);

  const createProjectFile = async (
    name: string,
    path: string,
    gitRemote: string | null = null
  ) => {
    const projectFile = join(ctx.globalDir, "projects", `${name}.yaml`);
    await writeFile(
      projectFile,
      JSON.stringify({
        name,
        path,
        gitRemote,
        registered: new Date().toISOString()
      })
    );
  };

  describe("resolvePaths", () => {
    test("returns local mode when .devsfactory exists in cwd", async () => {
      const projectDir = join(testRootDir, "my-local-project");
      const devsfactoryDir = join(projectDir, ".devsfactory");
      await mkdir(devsfactoryDir, { recursive: true });

      const mod = await reimportModule();
      const result = await runInCtx(() => mod.resolvePaths(projectDir));

      expect(result).not.toBeNull();
      expect(result!.mode).toBe("local");
      expect(result!.projectName).toBe("my-local-project");
      expect(result!.projectRoot).toBe(projectDir);
      expect(result!.devsfactoryDir).toBe(devsfactoryDir);
      expect(result!.worktreesDir).toBe(join(projectDir, ".worktrees"));
      expect(result!.brainstormDir).toBe(join(devsfactoryDir, "brainstorm"));
    });

    test("returns global mode when cwd is inside a registered project", async () => {
      const projectDir = join(testRootDir, "my-global-project");
      await mkdir(projectDir, { recursive: true });

      await createProjectFile(
        "test-project",
        projectDir,
        "git@github.com:test/test-project.git"
      );

      const mod = await reimportModule();
      const result = await runInCtx(() => mod.resolvePaths(projectDir));

      expect(result).not.toBeNull();
      expect(result!.mode).toBe("global");
      expect(result!.projectName).toBe("test-project");
      expect(result!.projectRoot).toBe(projectDir);
      expect(result!.devsfactoryDir).toBe(
        join(ctx.globalDir, "tasks", "test-project")
      );
      expect(result!.worktreesDir).toBe(
        join(ctx.globalDir, "worktrees", "test-project")
      );
      expect(result!.brainstormDir).toBe(
        join(ctx.globalDir, "brainstorm", "test-project")
      );
    });

    test("returns global mode when cwd is a subdirectory of registered project", async () => {
      const projectDir = join(testRootDir, "my-global-project");
      const subDir = join(projectDir, "src", "components");
      await mkdir(subDir, { recursive: true });

      await createProjectFile("test-project", projectDir);

      const mod = await reimportModule();
      const result = await runInCtx(() => mod.resolvePaths(subDir));

      expect(result).not.toBeNull();
      expect(result!.mode).toBe("global");
      expect(result!.projectName).toBe("test-project");
      expect(result!.projectRoot).toBe(projectDir);
    });

    test("returns null when not in any project context", async () => {
      const randomDir = join(testRootDir, "random-dir");
      await mkdir(randomDir, { recursive: true });

      const mod = await reimportModule();
      const result = await runInCtx(() => mod.resolvePaths(randomDir));

      expect(result).toBeNull();
    });

    test("prioritizes local mode over global when both conditions exist", async () => {
      const projectDir = join(testRootDir, "dual-mode-project");
      const devsfactoryDir = join(projectDir, ".devsfactory");
      await mkdir(devsfactoryDir, { recursive: true });

      await createProjectFile("test-project", projectDir);

      const mod = await reimportModule();
      const result = await runInCtx(() => mod.resolvePaths(projectDir));

      expect(result).not.toBeNull();
      expect(result!.mode).toBe("local");
    });
  });

  describe("resolvePathsForProject", () => {
    test("returns global mode paths for named project", async () => {
      const projectDir = join(testRootDir, "named-project");
      await mkdir(projectDir, { recursive: true });

      await createProjectFile(
        "my-named-project",
        projectDir,
        "git@github.com:test/my-named-project.git"
      );

      const mod = await reimportModule();
      const result = await runInCtx(() =>
        mod.resolvePathsForProject("my-named-project")
      );

      expect(result).not.toBeNull();
      expect(result!.mode).toBe("global");
      expect(result!.projectName).toBe("my-named-project");
      expect(result!.projectRoot).toBe(projectDir);
      expect(result!.devsfactoryDir).toBe(
        join(ctx.globalDir, "tasks", "my-named-project")
      );
      expect(result!.worktreesDir).toBe(
        join(ctx.globalDir, "worktrees", "my-named-project")
      );
      expect(result!.brainstormDir).toBe(
        join(ctx.globalDir, "brainstorm", "my-named-project")
      );
    });

    test("returns null for non-existent project", async () => {
      const mod = await reimportModule();
      const result = await runInCtx(() =>
        mod.resolvePathsForProject("non-existent-project")
      );

      expect(result).toBeNull();
    });
  });

  describe("isInProjectContext", () => {
    test("returns true when in local mode project", async () => {
      const projectDir = join(testRootDir, "local-context-project");
      const devsfactoryDir = join(projectDir, ".devsfactory");
      await mkdir(devsfactoryDir, { recursive: true });

      const mod = await reimportModule();
      const result = await runInCtx(() => mod.isInProjectContext(projectDir));

      expect(result).toBe(true);
    });

    test("returns true when in global mode project", async () => {
      const projectDir = join(testRootDir, "global-context-project");
      await mkdir(projectDir, { recursive: true });

      await createProjectFile("test-project", projectDir);

      const mod = await reimportModule();
      const result = await runInCtx(() => mod.isInProjectContext(projectDir));

      expect(result).toBe(true);
    });

    test("returns false when not in any project", async () => {
      const randomDir = join(testRootDir, "no-context-dir");
      await mkdir(randomDir, { recursive: true });

      const mod = await reimportModule();
      const result = await runInCtx(() => mod.isInProjectContext(randomDir));

      expect(result).toBe(false);
    });
  });
});

async function reimportModule() {
  const timestamp = Date.now();
  return await import(`./path-resolver?t=${timestamp}`);
}
