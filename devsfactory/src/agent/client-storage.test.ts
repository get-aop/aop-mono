import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AopDatabase } from "../core/sqlite/database";
import { ClientStorage } from "./client-storage";

describe("ClientStorage", () => {
  let dbPath: string;
  let db: AopDatabase;
  let storage: ClientStorage;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "client-storage-test-"));
    dbPath = join(tempDir, "test.db");
    db = new AopDatabase(dbPath);

    // Insert test project
    db.run(
      `INSERT INTO projects (name, path, registered_at) VALUES (?, ?, ?)`,
      ["test-project", "/test/path", new Date().toISOString()]
    );

    // Insert test task
    db.run(
      `INSERT INTO tasks (
        project_name, folder, title, status, priority, created_at,
        description, requirements, acceptance_criteria
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "test-project",
        "task-1",
        "Test Task",
        "INPROGRESS",
        "high",
        new Date().toISOString(),
        "Test description",
        "Test requirements",
        JSON.stringify(["AC1", "AC2"])
      ]
    );

    // Insert test subtasks
    db.run(
      `INSERT INTO subtasks (
        project_name, task_folder, filename, number, slug, title, status,
        dependencies, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "test-project",
        "task-1",
        "001-first-subtask.md",
        1,
        "first-subtask",
        "First Subtask",
        "DONE",
        "[]",
        "First subtask description"
      ]
    );

    db.run(
      `INSERT INTO subtasks (
        project_name, task_folder, filename, number, slug, title, status,
        dependencies, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "test-project",
        "task-1",
        "002-second-subtask.md",
        2,
        "second-subtask",
        "Second Subtask",
        "PENDING",
        "[1]",
        "Second subtask description"
      ]
    );

    db.run(
      `INSERT INTO subtasks (
        project_name, task_folder, filename, number, slug, title, status,
        dependencies, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "test-project",
        "task-1",
        "003-third-subtask.md",
        3,
        "third-subtask",
        "Third Subtask",
        "PENDING",
        "[2]",
        "Third subtask description"
      ]
    );

    // Insert test plan
    db.run(
      `INSERT INTO plans (
        project_name, task_folder, status, created_at, subtask_refs
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        "test-project",
        "task-1",
        "INPROGRESS",
        new Date().toISOString(),
        JSON.stringify([
          { number: 1, filename: "001-first-subtask.md" },
          { number: 2, filename: "002-second-subtask.md" },
          { number: 3, filename: "003-third-subtask.md" }
        ])
      ]
    );

    storage = new ClientStorage("test-project", db);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("getTask", () => {
    it("should return task by folder", () => {
      const task = storage.getTask("task-1");
      expect(task).not.toBeNull();
      expect(task?.folder).toBe("task-1");
      expect(task?.frontmatter.title).toBe("Test Task");
      expect(task?.frontmatter.status).toBe("INPROGRESS");
      expect(task?.frontmatter.priority).toBe("high");
    });

    it("should return null for non-existent task", () => {
      const task = storage.getTask("non-existent");
      expect(task).toBeNull();
    });
  });

  describe("getSubtask", () => {
    it("should return subtask by folder and filename", () => {
      const subtask = storage.getSubtask("task-1", "001-first-subtask.md");
      expect(subtask).not.toBeNull();
      expect(subtask?.filename).toBe("001-first-subtask.md");
      expect(subtask?.frontmatter.title).toBe("First Subtask");
      expect(subtask?.frontmatter.status).toBe("DONE");
    });

    it("should return null for non-existent subtask", () => {
      const subtask = storage.getSubtask("task-1", "non-existent.md");
      expect(subtask).toBeNull();
    });
  });

  describe("getPlan", () => {
    it("should return plan by folder", () => {
      const plan = storage.getPlan("task-1");
      expect(plan).not.toBeNull();
      expect(plan?.folder).toBe("task-1");
      expect(plan?.frontmatter.status).toBe("INPROGRESS");
      expect(plan?.subtasks).toHaveLength(3);
    });

    it("should return null for non-existent plan", () => {
      const plan = storage.getPlan("non-existent");
      expect(plan).toBeNull();
    });
  });

  describe("listSubtasks", () => {
    it("should return all subtasks in order", () => {
      const subtasks = storage.listSubtasks("task-1");
      expect(subtasks).toHaveLength(3);
      expect(subtasks[0]!.number).toBe(1);
      expect(subtasks[1]!.number).toBe(2);
      expect(subtasks[2]!.number).toBe(3);
    });

    it("should return empty array for non-existent task", () => {
      const subtasks = storage.listSubtasks("non-existent");
      expect(subtasks).toHaveLength(0);
    });
  });

  describe("listTasks", () => {
    it("should return all tasks", () => {
      const tasks = storage.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.folder).toBe("task-1");
    });
  });

  describe("getReadySubtasks", () => {
    it("should return subtasks with satisfied dependencies", () => {
      // Subtask 1 is DONE, so subtask 2 (depends on 1) should be ready
      const ready = storage.getReadySubtasks("task-1");
      expect(ready).toHaveLength(1);
      expect(ready[0]!.filename).toBe("002-second-subtask.md");
    });

    it("should not return subtasks with unsatisfied dependencies", () => {
      // Subtask 3 depends on subtask 2 which is still PENDING
      const ready = storage.getReadySubtasks("task-1");
      const hasThird = ready.some((s) => s.filename === "003-third-subtask.md");
      expect(hasThird).toBe(false);
    });
  });
});
