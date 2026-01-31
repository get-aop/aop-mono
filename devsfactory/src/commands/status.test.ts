import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  createIsolatedGlobalDir,
  type IsolatedGlobalDirContext
} from "../test-helpers";
import type { ProjectConfig } from "../types";
import { parseStatusArgs, runStatusCommand } from "./status";

let ctx: IsolatedGlobalDirContext;
let originalCwd: string;
let testRootDir: string;

const createProjectFile = async (project: ProjectConfig) => {
  const projectsDir = join(ctx.globalDir, "projects");
  await mkdir(projectsDir, { recursive: true });
  const content = YAML.stringify({
    ...project,
    registered: project.registered.toISOString()
  });
  await writeFile(join(projectsDir, `${project.name}.yaml`), content);
};

const createTaskFile = async (
  projectName: string,
  taskFolder: string,
  status: string
) => {
  const taskDir = join(ctx.globalDir, "tasks", projectName, taskFolder);
  await mkdir(taskDir, { recursive: true });
  const taskContent = `---
title: Test task
status: ${status}
created: 2026-01-28T00:00:00Z
priority: medium
tags: []
assignee: null
dependencies: []
---

## Description
Test task description

## Requirements
Test requirements

## Acceptance Criteria
- [ ] Criterion 1
`;
  await writeFile(join(taskDir, "task.md"), taskContent);
};

const createSubtaskFile = async (
  projectName: string,
  taskFolder: string,
  subtaskNumber: number,
  status: string
) => {
  const taskDir = join(ctx.globalDir, "tasks", projectName, taskFolder);
  await mkdir(taskDir, { recursive: true });
  const subtaskContent = `---
title: Subtask ${subtaskNumber}
status: ${status}
dependencies: []
---

### Description
Test subtask description
`;
  const filename = `${subtaskNumber.toString().padStart(3, "0")}-test-subtask.md`;
  await writeFile(join(taskDir, filename), subtaskContent);
};

describe("parseStatusArgs", () => {
  test("parses empty args - no project specified", () => {
    const result = parseStatusArgs([]);
    expect(result.projectName).toBeUndefined();
    expect(result.help).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  test("parses project name argument", () => {
    const result = parseStatusArgs(["my-project"]);
    expect(result.projectName).toBe("my-project");
  });

  test("parses help flag -h", () => {
    const result = parseStatusArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  test("parses help flag --help", () => {
    const result = parseStatusArgs(["--help"]);
    expect(result.help).toBe(true);
  });

  test("returns error for unknown option", () => {
    const result = parseStatusArgs(["--unknown"]);
    expect(result.error).toBe("Unknown option: --unknown");
  });
});

describe("runStatusCommand", () => {
  beforeEach(async () => {
    ctx = await createIsolatedGlobalDir("status-cmd");
    originalCwd = process.cwd();
    testRootDir = join(ctx.globalDir, "..");
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await ctx.cleanup();
  });

  describe("all projects summary", () => {
    test("shows empty state message when no projects registered", async () => {
      const result = await ctx.run(() => runStatusCommand());

      expect(result.success).toBe(true);
      expect(result.output).toContain("No projects registered");
      expect(result.output).toContain("aop init");
    });

    test("shows summary of all projects with task counts", async () => {
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

      // Create tasks for user-my-app: 2 PENDING, 1 INPROGRESS, 2 DONE
      await createTaskFile("user-my-app", "task-1", "PENDING");
      await createTaskFile("user-my-app", "task-2", "PENDING");
      await createTaskFile("user-my-app", "task-3", "INPROGRESS");
      await createTaskFile("user-my-app", "task-4", "DONE");
      await createTaskFile("user-my-app", "task-5", "DONE");

      // Create tasks for org-backend: 1 PENDING, 2 DONE
      await createTaskFile("org-backend", "task-1", "PENDING");
      await createTaskFile("org-backend", "task-2", "DONE");
      await createTaskFile("org-backend", "task-3", "DONE");

      const result = await ctx.run(() => runStatusCommand());

      expect(result.success).toBe(true);
      expect(result.output).toContain("PROJECT");
      expect(result.output).toContain("TASKS");
      expect(result.output).toContain("PENDING");
      expect(result.output).toContain("INPROGRESS");
      expect(result.output).toContain("DONE");
      expect(result.output).toContain("user-my-app");
      expect(result.output).toContain("org-backend");
      expect(result.output).toContain("Total: 8 tasks across 2 projects");
    });

    test("shows projects with zero tasks", async () => {
      await createProjectFile({
        name: "empty-project",
        path: "/home/user/empty",
        gitRemote: null,
        registered: new Date("2026-01-28T10:00:00Z")
      });

      const result = await ctx.run(() => runStatusCommand());

      expect(result.success).toBe(true);
      expect(result.output).toContain("empty-project");
      expect(result.output).toContain("Total: 0 tasks across 1 project");
    });
  });

  describe("single project status", () => {
    test("shows detailed task list for named project", async () => {
      await createProjectFile({
        name: "user-my-app",
        path: "/home/user/projects/my-app",
        gitRemote: "git@github.com:user/my-app.git",
        registered: new Date("2026-01-28T10:00:00Z")
      });

      await createTaskFile("user-my-app", "add-auth", "INPROGRESS");
      await createTaskFile("user-my-app", "fix-bug", "DONE");

      const result = await ctx.run(() => runStatusCommand("user-my-app"));

      expect(result.success).toBe(true);
      expect(result.output).toContain("user-my-app");
      expect(result.output).toContain("add-auth");
      expect(result.output).toContain("INPROGRESS");
      expect(result.output).toContain("fix-bug");
      expect(result.output).toContain("DONE");
    });

    test("shows subtask counts for tasks in progress", async () => {
      await createProjectFile({
        name: "user-my-app",
        path: "/home/user/projects/my-app",
        gitRemote: "git@github.com:user/my-app.git",
        registered: new Date("2026-01-28T10:00:00Z")
      });

      await createTaskFile("user-my-app", "add-auth", "INPROGRESS");
      await createSubtaskFile("user-my-app", "add-auth", 1, "DONE");
      await createSubtaskFile("user-my-app", "add-auth", 2, "INPROGRESS");
      await createSubtaskFile("user-my-app", "add-auth", 3, "PENDING");

      const result = await ctx.run(() => runStatusCommand("user-my-app"));

      expect(result.success).toBe(true);
      expect(result.output).toContain("1/3");
    });

    test("returns error for unknown project", async () => {
      const result = await ctx.run(() => runStatusCommand("nonexistent"));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Project 'nonexistent' not found");
    });

    test("shows empty state for project with no tasks", async () => {
      await createProjectFile({
        name: "empty-project",
        path: "/home/user/empty",
        gitRemote: null,
        registered: new Date("2026-01-28T10:00:00Z")
      });

      const result = await ctx.run(() => runStatusCommand("empty-project"));

      expect(result.success).toBe(true);
      expect(result.output).toContain("empty-project");
      expect(result.output).toContain("No tasks");
    });
  });

  describe("context-aware behavior", () => {
    test("shows current project if inside registered global project", async () => {
      const projectDir = join(testRootDir, "registered-project");
      await mkdir(projectDir, { recursive: true });

      await createProjectFile({
        name: "registered-project",
        path: projectDir,
        gitRemote: null,
        registered: new Date("2026-01-28T10:00:00Z")
      });

      await createTaskFile("registered-project", "global-task", "PENDING");

      process.chdir(projectDir);

      const result = await ctx.run(() => runStatusCommand());

      expect(result.success).toBe(true);
      expect(result.output).toContain("registered-project");
      expect(result.output).toContain("global-task");
    });
  });
});
