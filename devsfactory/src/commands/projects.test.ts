import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import type { ProjectConfig } from "../types";
import { parseProjectsArgs, runProjectsCommand } from "./projects";

let ctx: IsolatedGlobalDirContext;

const createProjectFile = async (project: ProjectConfig) => {
  const projectsDir = join(ctx.globalDir, "projects");
  await mkdir(projectsDir, { recursive: true });
  const content = YAML.stringify({
    ...project,
    registered: project.registered.toISOString()
  });
  await writeFile(join(projectsDir, `${project.name}.yaml`), content);
};

describe("parseProjectsArgs", () => {
  test("parses empty args as list command", () => {
    const result = parseProjectsArgs([]);
    expect(result.subcommand).toBe("list");
    expect(result.projectName).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("parses remove subcommand with project name", () => {
    const result = parseProjectsArgs(["remove", "my-project"]);
    expect(result.subcommand).toBe("remove");
    expect(result.projectName).toBe("my-project");
    expect(result.error).toBeUndefined();
  });

  test("returns error when remove is missing project name", () => {
    const result = parseProjectsArgs(["remove"]);
    expect(result.error).toBe("Missing project name for remove command");
  });

  test("returns error for unknown subcommand", () => {
    const result = parseProjectsArgs(["unknown"]);
    expect(result.error).toBe("Unknown subcommand: unknown");
  });

  test("returns error for unknown option", () => {
    const result = parseProjectsArgs(["--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });
});

describe("runProjectsCommand", () => {
  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("projects-cmd");
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe("list", () => {
    test("shows empty state message when no projects registered", async () => {
      const result = await ctx.run(() => runProjectsCommand("list", undefined));

      expect(result.success).toBe(true);
      expect(result.output).toContain("No projects registered");
      expect(result.output).toContain("aop init");
    });

    test("lists projects in formatted table", async () => {
      await createProjectFile({
        name: "user-my-app",
        path: "/home/user/projects/my-app",
        gitRemote: "git@github.com:user/my-app.git",
        registered: new Date("2026-01-28T10:00:00Z")
      });

      await createProjectFile({
        name: "org-backend",
        path: "/home/user/work/backend",
        gitRemote: "git@github.com:org/backend.git",
        registered: new Date("2026-01-25T08:00:00Z")
      });

      const result = await ctx.run(() => runProjectsCommand("list", undefined));

      expect(result.success).toBe(true);
      expect(result.output).toContain("NAME");
      expect(result.output).toContain("PATH");
      expect(result.output).toContain("REGISTERED");
      expect(result.output).toContain("user-my-app");
      expect(result.output).toContain("/home/user/projects/my-app");
      expect(result.output).toContain("org-backend");
      expect(result.output).toContain("/home/user/work/backend");
    });

    test("formats dates as YYYY-MM-DD", async () => {
      await createProjectFile({
        name: "test-project",
        path: "/test/path",
        gitRemote: null,
        registered: new Date("2026-01-28T10:00:00Z")
      });

      const result = await ctx.run(() => runProjectsCommand("list", undefined));

      expect(result.success).toBe(true);
      expect(result.output).toContain("2026-01-28");
    });
  });

  describe("remove", () => {
    test("unregisters existing project and prints confirmation", async () => {
      await createProjectFile({
        name: "user-my-app",
        path: "/home/user/projects/my-app",
        gitRemote: "git@github.com:user/my-app.git",
        registered: new Date("2026-01-28T10:00:00Z")
      });

      const result = await ctx.run(() =>
        runProjectsCommand("remove", "user-my-app")
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("✓");
      expect(result.output).toContain("Unregistered project 'user-my-app'");

      const file = Bun.file(
        join(ctx.globalDir, "projects", "user-my-app.yaml")
      );
      expect(await file.exists()).toBe(false);
    });

    test("returns error for non-existent project", async () => {
      const result = await ctx.run(() =>
        runProjectsCommand("remove", "nonexistent")
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Project 'nonexistent' not found");
    });
  });
});
