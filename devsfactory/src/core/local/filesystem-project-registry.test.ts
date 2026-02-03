import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../../test-helpers";
import type { ProjectConfig } from "../../types";

const isCI = !!process.env.CI;

describe.skipIf(isCI)("FileSystemProjectRegistry", () => {
  let ctx: IsolatedGlobalDirContext;

  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("filesystem-registry-test");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("should initialize and start without errors", async () => {
    await ctx.run(async () => {
      const { FileSystemProjectRegistry } = await import(
        "./filesystem-project-registry"
      );
      const registry = new FileSystemProjectRegistry();
      await registry.start();
      await registry.stop();
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
      const { FileSystemProjectRegistry } = await import(
        "./filesystem-project-registry"
      );
      const registry = new FileSystemProjectRegistry();
      await registry.start();

      const projects = await registry.listProjects();
      expect(projects.length).toBe(1);
      expect(projects[0]?.name).toBe("test-project");

      await registry.stop();
    });
  });

  it("should emit projectAdded when new project file is created", async () => {
    const addedProjects: ProjectConfig[] = [];

    await ctx.run(async () => {
      const { FileSystemProjectRegistry } = await import(
        "./filesystem-project-registry"
      );
      const registry = new FileSystemProjectRegistry({ debounceMs: 10 });

      registry.on("projectAdded", (project: ProjectConfig) => {
        addedProjects.push(project);
      });

      await registry.start();

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

      await registry.stop();
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
      const { FileSystemProjectRegistry } = await import(
        "./filesystem-project-registry"
      );
      const registry = new FileSystemProjectRegistry({ debounceMs: 50 });

      registry.on("projectRemoved", (name: string) => {
        removedProjects.push(name);
      });

      await registry.start();

      await new Promise((r) => setTimeout(r, 50));

      rmSync(projectFile);

      await new Promise((r) => setTimeout(r, 200));

      await registry.stop();
    });

    expect(removedProjects.length).toBe(1);
    expect(removedProjects[0]).toBe("to-remove");
  });

  it("should stop cleanly", async () => {
    await ctx.run(async () => {
      const { FileSystemProjectRegistry } = await import(
        "./filesystem-project-registry"
      );
      const registry = new FileSystemProjectRegistry();
      await registry.start();
      await registry.stop();
      await registry.stop();
    });
  });

  it("should get project by name", async () => {
    const projectConfig: ProjectConfig = {
      name: "find-me",
      path: "/test/path",
      gitRemote: "git@github.com:test/repo.git",
      registered: new Date()
    };
    writeFileSync(
      join(ctx.globalDir, "projects", "find-me.yaml"),
      YAML.stringify(projectConfig)
    );

    await ctx.run(async () => {
      const { FileSystemProjectRegistry } = await import(
        "./filesystem-project-registry"
      );
      const registry = new FileSystemProjectRegistry();
      await registry.start();

      const project = await registry.getProject("find-me");
      expect(project).not.toBeNull();
      expect(project?.name).toBe("find-me");

      const notFound = await registry.getProject("not-found");
      expect(notFound).toBeNull();

      await registry.stop();
    });
  });
});
