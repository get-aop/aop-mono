import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubtaskPreview, TaskPreview } from "../types";
import { createTaskFromBrainstorm } from "./task-finalization";

describe("createTaskFromBrainstorm", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `test-task-finalization-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const basicTaskPreview: TaskPreview = {
    title: "Add User Authentication",
    description: "Implement user authentication using JWT tokens",
    requirements: "Must support login, logout, and session refresh",
    acceptanceCriteria: [
      "Users can log in with email and password",
      "JWT tokens are issued on successful login",
      "Sessions can be refreshed before expiry"
    ]
  };

  const basicSubtasks: SubtaskPreview[] = [
    {
      number: 1,
      slug: "create-user-model",
      title: "Create User Model",
      description: "Define the user data model with password hashing",
      context: "Use existing database patterns",
      dependencies: []
    },
    {
      number: 2,
      slug: "implement-jwt-auth",
      title: "Implement JWT Authentication",
      description: "Create JWT token generation and validation",
      dependencies: [1]
    },
    {
      number: 3,
      slug: "add-login-endpoint",
      title: "Add Login Endpoint",
      description: "Create POST /api/auth/login endpoint",
      context: "Follow existing API patterns",
      dependencies: [1, 2]
    }
  ];

  describe("task folder creation", () => {
    test("creates task folder from slugified title", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      expect(result.taskFolder).toBe("add-user-authentication");

      const taskDir = join(tempDir, "add-user-authentication");
      const taskFile = Bun.file(join(taskDir, "task.md"));
      expect(await taskFile.exists()).toBe(true);
    });

    test("handles titles with special characters", async () => {
      const taskPreview: TaskPreview = {
        ...basicTaskPreview,
        title: "Add OAuth 2.0 Support (Beta)"
      };

      const result = await createTaskFromBrainstorm(
        taskPreview,
        basicSubtasks,
        tempDir
      );

      expect(result.taskFolder).toBe("add-oauth-20-support-beta");
    });

    test("handles titles with numbers", async () => {
      const taskPreview: TaskPreview = {
        ...basicTaskPreview,
        title: "Implement API v2"
      };

      const result = await createTaskFromBrainstorm(
        taskPreview,
        basicSubtasks,
        tempDir
      );

      expect(result.taskFolder).toBe("implement-api-v2");
    });

    test("appends random suffix when folder already exists", async () => {
      await mkdir(join(tempDir, "add-user-authentication"), {
        recursive: true
      });

      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      expect(result.taskFolder).toMatch(/^add-user-authentication-[a-z0-9]+$/);
    });
  });

  describe("task.md generation", () => {
    test("creates task.md with correct frontmatter", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const taskContent = await Bun.file(
        join(tempDir, result.taskFolder, "task.md")
      ).text();

      expect(taskContent).toContain("title: Add User Authentication");
      expect(taskContent).toContain("status: PENDING");
      expect(taskContent).toContain("priority: medium");
    });

    test("includes description section", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const taskContent = await Bun.file(
        join(tempDir, result.taskFolder, "task.md")
      ).text();

      expect(taskContent).toContain("## Description");
      expect(taskContent).toContain(
        "Implement user authentication using JWT tokens"
      );
    });

    test("includes requirements section", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const taskContent = await Bun.file(
        join(tempDir, result.taskFolder, "task.md")
      ).text();

      expect(taskContent).toContain("## Requirements");
      expect(taskContent).toContain(
        "Must support login, logout, and session refresh"
      );
    });

    test("includes acceptance criteria as checkboxes", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const taskContent = await Bun.file(
        join(tempDir, result.taskFolder, "task.md")
      ).text();

      expect(taskContent).toContain("## Acceptance Criteria");
      expect(taskContent).toContain(
        "- [ ] Users can log in with email and password"
      );
      expect(taskContent).toContain(
        "- [ ] JWT tokens are issued on successful login"
      );
      expect(taskContent).toContain(
        "- [ ] Sessions can be refreshed before expiry"
      );
    });
  });

  describe("subtask file generation", () => {
    test("creates subtask files with correct naming", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const taskDir = join(tempDir, result.taskFolder);

      const subtask1 = Bun.file(join(taskDir, "001-create-user-model.md"));
      const subtask2 = Bun.file(join(taskDir, "002-implement-jwt-auth.md"));
      const subtask3 = Bun.file(join(taskDir, "003-add-login-endpoint.md"));

      expect(await subtask1.exists()).toBe(true);
      expect(await subtask2.exists()).toBe(true);
      expect(await subtask3.exists()).toBe(true);
    });

    test("creates subtask with correct frontmatter", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const subtaskContent = await Bun.file(
        join(tempDir, result.taskFolder, "001-create-user-model.md")
      ).text();

      expect(subtaskContent).toContain("title: Create User Model");
      expect(subtaskContent).toContain("status: PENDING");
      expect(subtaskContent).toContain("dependencies: []");
    });

    test("includes dependencies in subtask frontmatter", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const subtask3Content = await Bun.file(
        join(tempDir, result.taskFolder, "003-add-login-endpoint.md")
      ).text();

      expect(subtask3Content).toContain("dependencies:");
      expect(subtask3Content).toMatch(/dependencies:\s*\n\s*- 1\s*\n\s*- 2/);
    });

    test("includes description section in subtask", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const subtaskContent = await Bun.file(
        join(tempDir, result.taskFolder, "001-create-user-model.md")
      ).text();

      expect(subtaskContent).toContain("### Description");
      expect(subtaskContent).toContain(
        "Define the user data model with password hashing"
      );
    });

    test("includes context section when provided", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const subtaskContent = await Bun.file(
        join(tempDir, result.taskFolder, "001-create-user-model.md")
      ).text();

      expect(subtaskContent).toContain("### Context");
      expect(subtaskContent).toContain("Use existing database patterns");
    });

    test("omits context section when not provided", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const subtaskContent = await Bun.file(
        join(tempDir, result.taskFolder, "002-implement-jwt-auth.md")
      ).text();

      const contextMatches = subtaskContent.match(/### Context/g);
      expect(contextMatches).toBeNull();
    });
  });

  describe("plan.md generation", () => {
    test("creates plan.md with correct frontmatter", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const planContent = await Bun.file(
        join(tempDir, result.taskFolder, "plan.md")
      ).text();

      expect(planContent).toContain("status: INPROGRESS");
      expect(planContent).toContain(`task: ${result.taskFolder}`);
    });

    test("lists all subtasks in plan", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const planContent = await Bun.file(
        join(tempDir, result.taskFolder, "plan.md")
      ).text();

      expect(planContent).toContain("## Subtasks");
      expect(planContent).toContain("001-create-user-model");
      expect(planContent).toContain("002-implement-jwt-auth");
      expect(planContent).toContain("003-add-login-endpoint");
    });

    test("includes dependencies in subtask list", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        basicSubtasks,
        tempDir
      );

      const planContent = await Bun.file(
        join(tempDir, result.taskFolder, "plan.md")
      ).text();

      expect(planContent).toContain("depends on: 1, 2");
    });
  });

  describe("edge cases", () => {
    test("handles empty subtasks array", async () => {
      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        [],
        tempDir
      );

      const taskDir = join(tempDir, result.taskFolder);
      const taskFile = Bun.file(join(taskDir, "task.md"));
      const planFile = Bun.file(join(taskDir, "plan.md"));

      expect(await taskFile.exists()).toBe(true);
      expect(await planFile.exists()).toBe(true);

      const planContent = await planFile.text();
      expect(planContent).toContain("## Subtasks");
    });

    test("handles empty acceptance criteria", async () => {
      const taskPreview: TaskPreview = {
        ...basicTaskPreview,
        acceptanceCriteria: []
      };

      const result = await createTaskFromBrainstorm(
        taskPreview,
        basicSubtasks,
        tempDir
      );

      const taskContent = await Bun.file(
        join(tempDir, result.taskFolder, "task.md")
      ).text();

      expect(taskContent).toContain("## Acceptance Criteria");
    });

    test("handles subtasks with no dependencies", async () => {
      const subtasks: SubtaskPreview[] = [
        {
          number: 1,
          slug: "task-a",
          title: "Task A",
          description: "Do A",
          dependencies: []
        },
        {
          number: 2,
          slug: "task-b",
          title: "Task B",
          description: "Do B",
          dependencies: []
        }
      ];

      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        subtasks,
        tempDir
      );

      const planContent = await Bun.file(
        join(tempDir, result.taskFolder, "plan.md")
      ).text();

      expect(planContent).not.toContain("depends on:");
    });

    test("preserves subtask order by number", async () => {
      const shuffledSubtasks: SubtaskPreview[] = [
        {
          number: 3,
          slug: "third",
          title: "Third",
          description: "Third task",
          dependencies: [1]
        },
        {
          number: 1,
          slug: "first",
          title: "First",
          description: "First task",
          dependencies: []
        },
        {
          number: 2,
          slug: "second",
          title: "Second",
          description: "Second task",
          dependencies: []
        }
      ];

      const result = await createTaskFromBrainstorm(
        basicTaskPreview,
        shuffledSubtasks,
        tempDir
      );

      const taskDir = join(tempDir, result.taskFolder);

      const subtask1 = Bun.file(join(taskDir, "001-first.md"));
      const subtask2 = Bun.file(join(taskDir, "002-second.md"));
      const subtask3 = Bun.file(join(taskDir, "003-third.md"));

      expect(await subtask1.exists()).toBe(true);
      expect(await subtask2.exists()).toBe(true);
      expect(await subtask3.exists()).toBe(true);
    });
  });

  describe("error handling", () => {
    test("throws error when devsfactory directory does not exist", async () => {
      await expect(
        createTaskFromBrainstorm(
          basicTaskPreview,
          basicSubtasks,
          "/nonexistent/path"
        )
      ).rejects.toThrow();
    });
  });
});
