import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import type { ProjectConfig } from "../types";

// Skip on CI: fs.watch with recursive:true on Linux doesn't release inotify handles
// properly, causing directory cleanup to hang indefinitely
const isCI = !!process.env.CI;

describe.skipIf(isCI)("ProjectRegistryWatcher", () => {
  let ctx: IsolatedGlobalDirContext;

  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("registry-watcher-test");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("should initialize with empty known projects", async () => {
    await ctx.run(async () => {
      const { ProjectRegistryWatcher } = await import(
        "./project-registry-watcher"
      );
      const watcher = new ProjectRegistryWatcher();
      await watcher.start();
      watcher.stop();
    });
  });

  it("should detect initial projects on start", async () => {
    const projectConfig: ProjectConfig = {
      name: "test-project",
      path: "/test/path",
      gitRemote: "git@github.com:test/repo.git",
      registered: new Date()
    };
    writeFileSync(
      join(ctx.globalDir, "projects", "test-project.yaml"),
      YAML.stringify(projectConfig)
    );

    await ctx.run(async () => {
      const { ProjectRegistryWatcher } = await import(
        "./project-registry-watcher"
      );
      const watcher = new ProjectRegistryWatcher();
      await watcher.start();
      watcher.stop();
    });
  });

  it("should emit projectAdded when new project file is created", async () => {
    const addedProjects: ProjectConfig[] = [];

    await ctx.run(async () => {
      const { ProjectRegistryWatcher } = await import(
        "./project-registry-watcher"
      );
      const watcher = new ProjectRegistryWatcher({ debounceMs: 10 });

      watcher.on("projectAdded", (project: ProjectConfig) => {
        addedProjects.push(project);
      });

      await watcher.start();

      const projectConfig: ProjectConfig = {
        name: "new-project",
        path: "/test/new-path",
        gitRemote: "git@github.com:test/new-repo.git",
        registered: new Date()
      };
      writeFileSync(
        join(ctx.globalDir, "projects", "new-project.yaml"),
        YAML.stringify(projectConfig)
      );

      await new Promise((r) => setTimeout(r, 100));

      watcher.stop();
    });

    expect(addedProjects.length).toBe(1);
    expect(addedProjects[0]?.name).toBe("new-project");
  });

  it("should emit projectRemoved when project file is deleted", async () => {
    const projectConfig: ProjectConfig = {
      name: "to-remove",
      path: "/test/path",
      gitRemote: "git@github.com:test/repo.git",
      registered: new Date()
    };
    const projectFile = join(ctx.globalDir, "projects", "to-remove.yaml");
    writeFileSync(projectFile, YAML.stringify(projectConfig));

    const removedProjects: string[] = [];

    await ctx.run(async () => {
      const { ProjectRegistryWatcher } = await import(
        "./project-registry-watcher"
      );
      const watcher = new ProjectRegistryWatcher({ debounceMs: 50 });

      watcher.on("projectRemoved", (name: string) => {
        removedProjects.push(name);
      });

      await watcher.start();

      // Small delay to ensure watcher is fully initialized
      await new Promise((r) => setTimeout(r, 50));

      rmSync(projectFile);

      // Wait for debounce + processing
      await new Promise((r) => setTimeout(r, 200));

      watcher.stop();
    });

    expect(removedProjects.length).toBe(1);
    expect(removedProjects[0]).toBe("to-remove");
  });

  it.skip("should handle .yml extension (flaky on WSL)", async () => {
    const addedProjects: ProjectConfig[] = [];

    await ctx.run(async () => {
      const { ProjectRegistryWatcher } = await import(
        "./project-registry-watcher"
      );
      const watcher = new ProjectRegistryWatcher({ debounceMs: 10 });

      watcher.on("projectAdded", (project: ProjectConfig) => {
        addedProjects.push(project);
      });

      await watcher.start();

      const projectConfig: ProjectConfig = {
        name: "yml-project",
        path: "/test/yml-path",
        gitRemote: "git@github.com:test/yml-repo.git",
        registered: new Date()
      };
      writeFileSync(
        join(ctx.globalDir, "projects", "yml-project.yml"),
        YAML.stringify(projectConfig)
      );

      await new Promise((r) => setTimeout(r, 200));

      watcher.stop();
    });

    expect(addedProjects.length).toBe(1);
    expect(addedProjects[0]?.name).toBe("yml-project");
  });

  it("should stop cleanly", async () => {
    await ctx.run(async () => {
      const { ProjectRegistryWatcher } = await import(
        "./project-registry-watcher"
      );
      const watcher = new ProjectRegistryWatcher();
      await watcher.start();
      watcher.stop();
      watcher.stop();
    });
  });
});
