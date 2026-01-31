import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import type { ProjectConfig } from "../types";

describe("MultiProjectRunner", () => {
  let ctx: IsolatedGlobalDirContext;

  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("multi-project-runner-test");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("should create instance with options", async () => {
    await ctx.run(async () => {
      const { MultiProjectRunner } = await import("./multi-project-runner");

      const runner = new MultiProjectRunner({
        maxConcurrentAgents: 2,
        debounceMs: 100,
        retryBackoff: { initialMs: 1000, maxMs: 60000, maxAttempts: 3 },
        dashboardPort: 3001,
        ignorePatterns: [".git"]
      });

      expect(runner).toBeDefined();
      expect(runner.getProjectNames()).toEqual([]);
    });
  });

  it("should return empty state when no projects", async () => {
    await ctx.run(async () => {
      const { MultiProjectRunner } = await import("./multi-project-runner");

      const runner = new MultiProjectRunner({
        maxConcurrentAgents: 2,
        debounceMs: 100,
        retryBackoff: { initialMs: 1000, maxMs: 60000, maxAttempts: 3 },
        dashboardPort: 3001,
        ignorePatterns: [".git"]
      });

      const state = runner.getState();
      expect(state.tasks).toEqual([]);
      expect(state.plans).toEqual({});
      expect(state.subtasks).toEqual({});
    });
  });

  it("should implement OrchestratorLike interface", async () => {
    await ctx.run(async () => {
      const { MultiProjectRunner } = await import("./multi-project-runner");

      const runner = new MultiProjectRunner({
        maxConcurrentAgents: 2,
        debounceMs: 100,
        retryBackoff: { initialMs: 1000, maxMs: 60000, maxAttempts: 3 },
        dashboardPort: 3001,
        ignorePatterns: [".git"]
      });

      expect(typeof runner.getState).toBe("function");
      expect(typeof runner.getActiveAgents).toBe("function");
      expect(typeof runner.on).toBe("function");
      expect(typeof runner.off).toBe("function");
    });
  });

  it("should return active agents from all projects", async () => {
    await ctx.run(async () => {
      const { MultiProjectRunner } = await import("./multi-project-runner");

      const runner = new MultiProjectRunner({
        maxConcurrentAgents: 2,
        debounceMs: 100,
        retryBackoff: { initialMs: 1000, maxMs: 60000, maxAttempts: 3 },
        dashboardPort: 3001,
        ignorePatterns: [".git"]
      });

      const agents = await runner.getActiveAgents();
      expect(agents).toEqual([]);
    });
  });

  it("should list projects from registry", async () => {
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
      const { MultiProjectRunner } = await import("./multi-project-runner");

      const runner = new MultiProjectRunner({
        maxConcurrentAgents: 2,
        debounceMs: 100,
        retryBackoff: { initialMs: 1000, maxMs: 60000, maxAttempts: 3 },
        dashboardPort: 3001,
        ignorePatterns: [".git"]
      });

      const projects = await runner.listProjects();
      expect(projects.length).toBe(1);
      expect(projects[0]?.name).toBe("test-project");
    });
  });

  it("should get project by name", async () => {
    const projectConfig: ProjectConfig = {
      name: "my-project",
      path: "/test/my-project",
      gitRemote: "git@github.com:test/my-repo.git",
      registered: new Date()
    };
    writeFileSync(
      join(ctx.globalDir, "projects", "my-project.yaml"),
      YAML.stringify(projectConfig)
    );

    await ctx.run(async () => {
      const { MultiProjectRunner } = await import("./multi-project-runner");

      const runner = new MultiProjectRunner({
        maxConcurrentAgents: 2,
        debounceMs: 100,
        retryBackoff: { initialMs: 1000, maxMs: 60000, maxAttempts: 3 },
        dashboardPort: 3001,
        ignorePatterns: [".git"]
      });

      const project = await runner.getProject("my-project");
      expect(project).not.toBeNull();
      expect(project?.name).toBe("my-project");

      const notFound = await runner.getProject("nonexistent");
      expect(notFound).toBeNull();
    });
  });

  it("should scan project returns empty state for non-running project", async () => {
    await ctx.run(async () => {
      const { MultiProjectRunner } = await import("./multi-project-runner");

      const runner = new MultiProjectRunner({
        maxConcurrentAgents: 2,
        debounceMs: 100,
        retryBackoff: { initialMs: 1000, maxMs: 60000, maxAttempts: 3 },
        dashboardPort: 3001,
        ignorePatterns: [".git"]
      });

      const result = await runner.scanProject("nonexistent");
      expect(result.tasks).toEqual([]);
      expect(result.plans).toEqual({});
      expect(result.subtasks).toEqual({});
    });
  });

  it("should stop cleanly with no projects", async () => {
    await ctx.run(async () => {
      const { MultiProjectRunner } = await import("./multi-project-runner");

      const runner = new MultiProjectRunner({
        maxConcurrentAgents: 2,
        debounceMs: 100,
        retryBackoff: { initialMs: 1000, maxMs: 60000, maxAttempts: 3 },
        dashboardPort: 3001,
        ignorePatterns: [".git"]
      });

      await runner.stop();
      expect(runner.getProjectNames()).toEqual([]);
    });
  });
});
