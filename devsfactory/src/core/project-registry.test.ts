import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import type { ProjectConfig } from "../types";

const fileExists = async (path: string): Promise<boolean> => {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
};

describe("project-registry", () => {
  let ctx: IsolatedGlobalDirContext;
  let testRootDir: string;

  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("project-registry");
    testRootDir = join(ctx.globalDir, "..");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  const runInCtx = <T>(fn: () => T | Promise<T>) => ctx.run(fn);

  describe("extractProjectNameFromRemote", () => {
    test("parses SSH remote URL", async () => {
      const mod = await reimportModule();
      expect(
        mod.extractProjectNameFromRemote("git@github.com:user/my-repo.git")
      ).toBe("user-my-repo");
    });

    test("parses HTTPS remote URL", async () => {
      const mod = await reimportModule();
      expect(
        mod.extractProjectNameFromRemote("https://github.com/org/project.git")
      ).toBe("org-project");
    });

    test("parses HTTPS remote URL without .git suffix", async () => {
      const mod = await reimportModule();
      expect(
        mod.extractProjectNameFromRemote("https://github.com/org/project")
      ).toBe("org-project");
    });

    test("handles nested paths in SSH URL", async () => {
      const mod = await reimportModule();
      expect(
        mod.extractProjectNameFromRemote(
          "git@gitlab.com:group/subgroup/project.git"
        )
      ).toBe("group-subgroup-project");
    });

    test("handles nested paths in HTTPS URL", async () => {
      const mod = await reimportModule();
      expect(
        mod.extractProjectNameFromRemote(
          "https://gitlab.com/group/subgroup/project.git"
        )
      ).toBe("group-subgroup-project");
    });

    test("handles BitBucket SSH URLs", async () => {
      const mod = await reimportModule();
      expect(
        mod.extractProjectNameFromRemote(
          "git@bitbucket.org:myteam/myproject.git"
        )
      ).toBe("myteam-myproject");
    });
  });

  describe("registerProject", () => {
    let repoDir: string;

    beforeEach(async () => {
      repoDir = join(testRootDir, "test-repo");
      await mkdir(repoDir);
      await Bun.$`git -C ${repoDir} init`.quiet();
      await Bun.$`git -C ${repoDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${repoDir} config user.name "Test"`.quiet();
      await writeFile(join(repoDir, "README.md"), "# Test Repo");
      await Bun.$`git -C ${repoDir} add .`.quiet();
      await Bun.$`git -C ${repoDir} commit -m "initial"`.quiet();
    });

    test("registers a git repository with remote URL", async () => {
      await Bun.$`git -C ${repoDir} remote add origin git@github.com:testuser/test-repo.git`.quiet();

      const mod = await reimportModule();
      const config = await runInCtx(() => mod.registerProject(repoDir));

      expect(config.name).toBe("testuser-test-repo");
      expect(config.path).toBe(repoDir);
      // Git config may rewrite URLs (e.g., github.com -> github.com-personal)
      // So we check for the essential parts rather than exact match
      expect(config.gitRemote).toContain("testuser/test-repo.git");
      expect(config.registered).toBeInstanceOf(Date);

      const projectFile = join(
        ctx.globalDir,
        "projects",
        "testuser-test-repo.yaml"
      );
      expect(await fileExists(projectFile)).toBe(true);
    });

    test("registers a git repository without remote - falls back to directory name", async () => {
      const mod = await reimportModule();
      const config = await runInCtx(() => mod.registerProject(repoDir));

      expect(config.name).toBe("test-repo");
      expect(config.gitRemote).toBeNull();
    });

    test("throws error if path is not a git repository", async () => {
      // Use a temp directory outside the devsfactory git repo to avoid
      // git finding the parent repo when running rev-parse --show-toplevel
      const nonGitDir = join("/tmp", `aop-test-non-git-${Date.now()}`);
      await mkdir(nonGitDir);

      try {
        const mod = await reimportModule();
        await expect(
          runInCtx(() => mod.registerProject(nonGitDir))
        ).rejects.toThrow("not inside a git repository");
      } finally {
        // Clean up
        await rm(nonGitDir, { recursive: true, force: true });
      }
    });

    test("throws error if project with same name already exists", async () => {
      await Bun.$`git -C ${repoDir} remote add origin git@github.com:testuser/test-repo.git`.quiet();

      const mod = await reimportModule();
      await runInCtx(() => mod.registerProject(repoDir));
      await expect(
        runInCtx(() => mod.registerProject(repoDir))
      ).rejects.toThrow("already registered");
    });

    test("validates filesystem compatibility for worktrees", async () => {
      const mod = await reimportModule();
      const config = await runInCtx(() => mod.registerProject(repoDir));

      expect(config).toBeDefined();
    });

    test("creates project YAML file with correct structure", async () => {
      await Bun.$`git -C ${repoDir} remote add origin https://github.com/org/myproject.git`.quiet();

      const mod = await reimportModule();
      await runInCtx(() => mod.registerProject(repoDir));

      const projectFile = join(ctx.globalDir, "projects", "org-myproject.yaml");
      const content = await Bun.file(projectFile).text();
      const parsed = YAML.parse(content) as ProjectConfig;

      expect(parsed.name).toBe("org-myproject");
      expect(parsed.path).toBe(repoDir);
      expect(parsed.gitRemote).toBe("https://github.com/org/myproject.git");
      expect(parsed.registered).toBeDefined();
    });
  });

  describe("unregisterProject", () => {
    let repoDir: string;

    beforeEach(async () => {
      repoDir = join(testRootDir, "test-repo");
      await mkdir(repoDir);
      await Bun.$`git -C ${repoDir} init`.quiet();
      await Bun.$`git -C ${repoDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${repoDir} config user.name "Test"`.quiet();
      await writeFile(join(repoDir, "README.md"), "# Test Repo");
      await Bun.$`git -C ${repoDir} add .`.quiet();
      await Bun.$`git -C ${repoDir} commit -m "initial"`.quiet();
    });

    test("removes project registration file", async () => {
      const mod = await reimportModule();
      await runInCtx(() => mod.registerProject(repoDir));

      const projectFile = join(ctx.globalDir, "projects", "test-repo.yaml");
      expect(await fileExists(projectFile)).toBe(true);

      await runInCtx(() => mod.unregisterProject("test-repo"));
      expect(await fileExists(projectFile)).toBe(false);
    });

    test("throws error if project does not exist", async () => {
      const mod = await reimportModule();
      await expect(
        runInCtx(() => mod.unregisterProject("nonexistent"))
      ).rejects.toThrow("not found");
    });

    test("does not delete task files when unregistering", async () => {
      const mod = await reimportModule();
      await runInCtx(() => mod.registerProject(repoDir));

      const tasksDir = join(ctx.globalDir, "tasks", "test-repo");
      await mkdir(tasksDir, { recursive: true });
      await writeFile(join(tasksDir, "task.md"), "task content");

      await runInCtx(() => mod.unregisterProject("test-repo"));

      expect(await fileExists(join(tasksDir, "task.md"))).toBe(true);
    });
  });

  describe("listProjects", () => {
    test("returns empty array when no projects registered", async () => {
      const mod = await reimportModule();
      const projects = await runInCtx(() => mod.listProjects());
      expect(projects).toEqual([]);
    });

    test("lists multiple registered projects", async () => {
      const repo1 = join(testRootDir, "repo1");
      const repo2 = join(testRootDir, "repo2");

      for (const dir of [repo1, repo2]) {
        await mkdir(dir);
        await Bun.$`git -C ${dir} init`.quiet();
        await Bun.$`git -C ${dir} config user.email "test@test.com"`.quiet();
        await Bun.$`git -C ${dir} config user.name "Test"`.quiet();
        await writeFile(join(dir, "README.md"), "# Test Repo");
        await Bun.$`git -C ${dir} add .`.quiet();
        await Bun.$`git -C ${dir} commit -m "initial"`.quiet();
      }

      const mod = await reimportModule();
      await runInCtx(() => mod.registerProject(repo1));
      await runInCtx(() => mod.registerProject(repo2));

      const projects = await runInCtx(() => mod.listProjects());
      expect(projects).toHaveLength(2);
      expect(projects.map((p: ProjectConfig) => p.name).sort()).toEqual([
        "repo1",
        "repo2"
      ]);
    });

    test("ignores non-YAML files in projects directory", async () => {
      await writeFile(join(ctx.globalDir, "projects", "README.md"), "notes");
      await writeFile(join(ctx.globalDir, "projects", ".gitkeep"), "");

      const mod = await reimportModule();
      const projects = await runInCtx(() => mod.listProjects());
      expect(projects).toEqual([]);
    });
  });

  describe("getProject", () => {
    let repoDir: string;

    beforeEach(async () => {
      repoDir = join(testRootDir, "myproject");
      await mkdir(repoDir);
      await Bun.$`git -C ${repoDir} init`.quiet();
      await Bun.$`git -C ${repoDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${repoDir} config user.name "Test"`.quiet();
      await writeFile(join(repoDir, "README.md"), "# Test Repo");
      await Bun.$`git -C ${repoDir} add .`.quiet();
      await Bun.$`git -C ${repoDir} commit -m "initial"`.quiet();
    });

    test("returns project config by name", async () => {
      const mod = await reimportModule();
      await runInCtx(() => mod.registerProject(repoDir));

      const project = await runInCtx(() => mod.getProject("myproject"));
      expect(project).not.toBeNull();
      expect(project!.name).toBe("myproject");
    });

    test("returns null for non-existent project", async () => {
      const mod = await reimportModule();
      const project = await runInCtx(() => mod.getProject("nonexistent"));
      expect(project).toBeNull();
    });
  });

  describe("findProjectByPath", () => {
    let repoDir: string;
    let subDir: string;

    beforeEach(async () => {
      repoDir = join(testRootDir, "findtest");
      subDir = join(repoDir, "src", "components");
      await mkdir(subDir, { recursive: true });
      await Bun.$`git -C ${repoDir} init`.quiet();
      await Bun.$`git -C ${repoDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${repoDir} config user.name "Test"`.quiet();
      await writeFile(join(repoDir, "README.md"), "# Test Repo");
      await Bun.$`git -C ${repoDir} add .`.quiet();
      await Bun.$`git -C ${repoDir} commit -m "initial"`.quiet();
    });

    test("finds project containing the given path", async () => {
      const mod = await reimportModule();
      await runInCtx(() => mod.registerProject(repoDir));

      const project = await runInCtx(() => mod.findProjectByPath(subDir));
      expect(project).not.toBeNull();
      expect(project!.name).toBe("findtest");
    });

    test("finds project when path is the project root", async () => {
      const mod = await reimportModule();
      await runInCtx(() => mod.registerProject(repoDir));

      const project = await runInCtx(() => mod.findProjectByPath(repoDir));
      expect(project).not.toBeNull();
      expect(project!.name).toBe("findtest");
    });

    test("returns null when path is not inside any registered project", async () => {
      const mod = await reimportModule();
      await runInCtx(() => mod.registerProject(repoDir));

      const otherDir = join(testRootDir, "other");
      await mkdir(otherDir, { recursive: true });

      const project = await runInCtx(() => mod.findProjectByPath(otherDir));
      expect(project).toBeNull();
    });

    test("returns null when no projects are registered", async () => {
      const mod = await reimportModule();
      const project = await runInCtx(() => mod.findProjectByPath(subDir));
      expect(project).toBeNull();
    });
  });
});

async function reimportModule() {
  const timestamp = Date.now();
  return await import(`./project-registry?t=${timestamp}`);
}
