import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubtaskWithContent, Task, TaskWithContent } from "../../types";
import { AopDatabase, resetDatabaseInstance } from "./database";
import { SQLiteTaskStorage } from "./sqlite-task-storage";

describe("SQLiteTaskStorage", () => {
  let tempDir: string;
  let db: AopDatabase;
  let storage: SQLiteTaskStorage;
  const projectName = "test-project";

  const createTestTask = (folder: string, overrides?: Partial<Task>): Task => ({
    folder,
    frontmatter: {
      title: `Task ${folder}`,
      status: "PENDING",
      created: new Date("2026-01-01"),
      priority: "medium",
      tags: [],
      assignee: null,
      dependencies: [],
      startedAt: null,
      completedAt: null,
      durationMs: null
    },
    description: "Test description",
    requirements: "Test requirements",
    acceptanceCriteria: [{ text: "Criterion 1", checked: false }],
    ...overrides
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sqlite-task-storage-test-"));
    const dbPath = join(tempDir, "test.db");
    db = new AopDatabase(dbPath);

    db.run(
      `INSERT INTO projects (name, path, registered_at) VALUES (?, ?, ?)`,
      [projectName, "/path/to/project", new Date().toISOString()]
    );

    storage = new SQLiteTaskStorage({ projectName, db, pollMs: 50 });
  });

  afterEach(async () => {
    await storage.stop();
    db.close();
    resetDatabaseInstance();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createTask", () => {
    it("should create a new task", async () => {
      const task = createTestTask("my-task");
      await storage.createTask("my-task", task);

      const retrieved = await storage.getTask("my-task");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.folder).toBe("my-task");
      expect(retrieved!.frontmatter.title).toBe("Task my-task");
    });

    it("should emit taskChanged event", async () => {
      const events: { taskFolder: string }[] = [];
      storage.on("taskChanged", (e) => events.push(e));

      await storage.createTask("my-task", createTestTask("my-task"));

      expect(events).toHaveLength(1);
      expect(events[0]!.taskFolder).toBe("my-task");
    });
  });

  describe("listTaskFolders", () => {
    it("should return empty array when no tasks", async () => {
      const folders = await storage.listTaskFolders();
      expect(folders).toEqual([]);
    });

    it("should return all task folders", async () => {
      await storage.createTask("task-a", createTestTask("task-a"));
      await storage.createTask("task-b", createTestTask("task-b"));

      const folders = await storage.listTaskFolders();

      expect(folders).toHaveLength(2);
      expect(folders).toContain("task-a");
      expect(folders).toContain("task-b");
    });

    it("should only return tasks for this project", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      db.run(
        `INSERT INTO projects (name, path, registered_at) VALUES (?, ?, ?)`,
        ["other-project", "/other/path", new Date().toISOString()]
      );
      db.run(
        `INSERT INTO tasks (project_name, folder, title, status, priority, created_at, description, requirements, acceptance_criteria)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "other-project",
          "other-task",
          "Other",
          "PENDING",
          "low",
          new Date().toISOString(),
          "desc",
          "req",
          "[]"
        ]
      );

      const folders = await storage.listTaskFolders();

      expect(folders).toEqual(["my-task"]);
    });
  });

  describe("getTask", () => {
    it("should return null for non-existent task", async () => {
      const task = await storage.getTask("non-existent");
      expect(task).toBeNull();
    });

    it("should return task with all fields", async () => {
      const input = createTestTask("my-task", {
        frontmatter: {
          title: "My Task",
          status: "INPROGRESS",
          created: new Date("2026-01-15"),
          priority: "high",
          tags: ["bug", "urgent"],
          assignee: "developer",
          dependencies: ["other-task"],
          branch: "fix/my-task",
          startedAt: new Date("2026-01-16"),
          completedAt: null,
          durationMs: null
        },
        notes: "Some notes"
      });

      await storage.createTask("my-task", input);
      const task = await storage.getTask("my-task");

      expect(task!.frontmatter.title).toBe("My Task");
      expect(task!.frontmatter.status).toBe("INPROGRESS");
      expect(task!.frontmatter.priority).toBe("high");
      expect(task!.frontmatter.tags).toEqual(["bug", "urgent"]);
      expect(task!.frontmatter.assignee).toBe("developer");
      expect(task!.frontmatter.branch).toBe("fix/my-task");
      expect(task!.notes).toBe("Some notes");
    });
  });

  describe("getTaskId", () => {
    it("should return rowid for existing task", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const taskId = await storage.getTaskId("my-task");

      expect(taskId).not.toBeNull();
      expect(typeof taskId).toBe("number");
    });
  });

  describe("getTaskFolderById", () => {
    it("should resolve folder by task id", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const taskId = await storage.getTaskId("my-task");
      const folder = await storage.getTaskFolderById(taskId!);

      expect(folder).toBe("my-task");
    });
  });

  describe("updateTaskStatusById", () => {
    it("should update status using task id", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const taskId = await storage.getTaskId("my-task");

      await storage.updateTaskStatusById(taskId!, "DONE");

      const updated = await storage.getTask("my-task");
      expect(updated!.frontmatter.status).toBe("DONE");
    });
  });

  describe("updateTaskStatus", () => {
    it("should update task status", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      await storage.updateTaskStatus("my-task", "INPROGRESS");

      const task = await storage.getTask("my-task");
      expect(task!.frontmatter.status).toBe("INPROGRESS");
    });

    it("should emit taskChanged event", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const events: { taskFolder: string }[] = [];
      storage.on("taskChanged", (e) => events.push(e));

      await storage.updateTaskStatus("my-task", "DONE");

      expect(events).toHaveLength(1);
    });
  });

  describe("updateTaskTiming", () => {
    it("should update task timing", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const startedAt = new Date("2026-01-15T10:00:00Z");
      const completedAt = new Date("2026-01-15T12:00:00Z");

      await storage.updateTaskTiming("my-task", {
        startedAt,
        completedAt,
        durationMs: 7200000
      });

      const task = await storage.getTask("my-task");
      expect(task!.frontmatter.startedAt?.toISOString()).toBe(
        startedAt.toISOString()
      );
      expect(task!.frontmatter.completedAt?.toISOString()).toBe(
        completedAt.toISOString()
      );
      expect(task!.frontmatter.durationMs).toBe(7200000);
    });
  });

  describe("createSubtask", () => {
    it("should create a subtask with auto-generated filename", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const filename = await storage.createSubtask("my-task", {
        frontmatter: {
          title: "Implement feature",
          status: "PENDING",
          dependencies: []
        },
        description: "Do the thing"
      });

      expect(filename).toBe("001-implement-feature.md");

      const subtask = await storage.getSubtask("my-task", filename);
      expect(subtask).not.toBeNull();
      expect(subtask!.frontmatter.title).toBe("Implement feature");
      expect(subtask!.number).toBe(1);
    });

    it("should increment subtask numbers", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const f1 = await storage.createSubtask("my-task", {
        frontmatter: { title: "First", status: "PENDING" },
        description: "First subtask"
      });

      const f2 = await storage.createSubtask("my-task", {
        frontmatter: { title: "Second", status: "PENDING" },
        description: "Second subtask"
      });

      expect(f1).toBe("001-first.md");
      expect(f2).toBe("002-second.md");
    });
  });

  describe("listSubtasks", () => {
    it("should return subtasks in order", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      await storage.createSubtask("my-task", {
        frontmatter: { title: "First", status: "PENDING" },
        description: "First"
      });
      await storage.createSubtask("my-task", {
        frontmatter: { title: "Second", status: "PENDING" },
        description: "Second"
      });

      const subtasks = await storage.listSubtasks("my-task");

      expect(subtasks).toHaveLength(2);
      expect(subtasks[0]!.number).toBe(1);
      expect(subtasks[1]!.number).toBe(2);
    });
  });

  describe("getReadySubtasks", () => {
    it("should return PENDING subtasks with no dependencies", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      await storage.createSubtask("my-task", {
        frontmatter: { title: "Ready", status: "PENDING", dependencies: [] },
        description: "Ready"
      });
      await storage.createSubtask("my-task", {
        frontmatter: { title: "Blocked", status: "PENDING", dependencies: [1] },
        description: "Blocked"
      });

      const ready = await storage.getReadySubtasks("my-task");

      expect(ready).toHaveLength(1);
      expect(ready[0]!.frontmatter.title).toBe("Ready");
    });

    it("should include subtasks whose dependencies are DONE", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const f1 = await storage.createSubtask("my-task", {
        frontmatter: { title: "First", status: "PENDING", dependencies: [] },
        description: "First"
      });
      await storage.createSubtask("my-task", {
        frontmatter: { title: "Second", status: "PENDING", dependencies: [1] },
        description: "Second"
      });

      await storage.updateSubtaskStatus("my-task", f1, "DONE");

      const ready = await storage.getReadySubtasks("my-task");

      expect(ready).toHaveLength(1);
      expect(ready[0]!.frontmatter.title).toBe("Second");
    });
  });

  describe("updateSubtaskStatus", () => {
    it("should update subtask status", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const filename = await storage.createSubtask("my-task", {
        frontmatter: { title: "Test", status: "PENDING" },
        description: "Test"
      });

      await storage.updateSubtaskStatus("my-task", filename, "INPROGRESS");

      const subtask = await storage.getSubtask("my-task", filename);
      expect(subtask!.frontmatter.status).toBe("INPROGRESS");
    });
  });

  describe("recordPhaseDuration", () => {
    it("should record phase duration", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const filename = await storage.createSubtask("my-task", {
        frontmatter: { title: "Test", status: "PENDING" },
        description: "Test"
      });

      await storage.recordPhaseDuration(
        "my-task",
        filename,
        "implementation",
        5000
      );
      await storage.recordPhaseDuration("my-task", filename, "review", 3000);

      const subtask = await storage.getSubtask("my-task", filename);
      expect(subtask!.frontmatter.timing?.phases.implementation).toBe(5000);
      expect(subtask!.frontmatter.timing?.phases.review).toBe(3000);
    });
  });

  describe("appendReviewHistory", () => {
    it("should append review content", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const filename = await storage.createSubtask("my-task", {
        frontmatter: { title: "Test", status: "PENDING" },
        description: "Test"
      });

      await storage.appendReviewHistory("my-task", filename, "First review");
      await storage.appendReviewHistory("my-task", filename, "Second review");

      const subtask = await storage.getSubtask("my-task", filename);
      expect(subtask!.review).toContain("First review");
      expect(subtask!.review).toContain("Second review");
      expect(subtask!.review).toContain("---");
    });
  });

  describe("scan", () => {
    it("should return all tasks, plans, and subtasks", async () => {
      await storage.createTask("task-a", createTestTask("task-a"));
      await storage.createTask("task-b", createTestTask("task-b"));
      await storage.createSubtask("task-a", {
        frontmatter: { title: "Subtask", status: "PENDING" },
        description: "Subtask"
      });

      const result = await storage.scan();

      expect(result.tasks).toHaveLength(2);
      expect(Object.keys(result.subtasks)).toContain("task-a");
      expect(result.subtasks["task-a"]).toHaveLength(1);
    });
  });

  describe("lifecycle", () => {
    it("should report watching state", async () => {
      expect(storage.isWatching()).toBe(false);

      await storage.start();
      expect(storage.isWatching()).toBe(true);

      await storage.stop();
      expect(storage.isWatching()).toBe(false);
    });
  });

  describe("plans", () => {
    it("should create and retrieve plan", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      await storage.createPlan("my-task", {
        frontmatter: {
          status: "INPROGRESS",
          task: "my-task",
          created: new Date("2026-01-01")
        },
        subtasks: [
          { number: 1, slug: "first", title: "First", dependencies: [] },
          { number: 2, slug: "second", title: "Second", dependencies: [1] }
        ]
      });

      const plan = await storage.getPlan("my-task");

      expect(plan).not.toBeNull();
      expect(plan!.frontmatter.status).toBe("INPROGRESS");
      expect(plan!.subtasks).toHaveLength(2);
    });

    it("should update plan status", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      await storage.createPlan("my-task", {
        frontmatter: {
          status: "INPROGRESS",
          task: "my-task",
          created: new Date()
        },
        subtasks: []
      });

      await storage.updatePlanStatus("my-task", "REVIEW");

      const plan = await storage.getPlan("my-task");
      expect(plan!.frontmatter.status).toBe("REVIEW");
    });
  });

  describe("getTaskWithContent", () => {
    it("should return null for non-existent task", async () => {
      const task = await storage.getTaskWithContent("non-existent");
      expect(task).toBeNull();
    });

    it("should return task with full content", async () => {
      const input = createTestTask("my-task", {
        description: "Full task description",
        requirements: "Detailed requirements",
        acceptanceCriteria: [
          { text: "First criterion", checked: false },
          { text: "Second criterion", checked: true }
        ],
        notes: "Important notes"
      });
      await storage.createTask("my-task", input);

      const task = await storage.getTaskWithContent("my-task");

      expect(task).not.toBeNull();
      expect(task!.folder).toBe("my-task");
      expect(task!.description).toBe("Full task description");
      expect(task!.requirements).toBe("Detailed requirements");
      expect(task!.acceptanceCriteria).toEqual([
        "First criterion",
        "Second criterion"
      ]);
      expect(task!.notes).toBe("Important notes");
    });

    it("should return empty arrays for missing criteria", async () => {
      await storage.createTask(
        "my-task",
        createTestTask("my-task", {
          acceptanceCriteria: []
        })
      );

      const task = await storage.getTaskWithContent("my-task");

      expect(task!.acceptanceCriteria).toEqual([]);
    });
  });

  describe("getSubtaskWithContent", () => {
    it("should return null for non-existent subtask", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const subtask = await storage.getSubtaskWithContent(
        "my-task",
        "non-existent.md"
      );
      expect(subtask).toBeNull();
    });

    it("should return subtask with full content", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const filename = await storage.createSubtaskWithContent("my-task", {
        filename: "001-implement-feature.md",
        frontmatter: {
          title: "Implement feature",
          status: "PENDING",
          dependencies: []
        },
        objective: "Implement the main feature",
        acceptanceCriteria: "- Feature works correctly\n- Tests pass",
        tasksChecklist: "- [ ] Write code\n- [ ] Write tests",
        result: undefined
      });

      const subtask = await storage.getSubtaskWithContent("my-task", filename);

      expect(subtask).not.toBeNull();
      expect(subtask!.filename).toBe(filename);
      expect(subtask!.objective).toBe("Implement the main feature");
      expect(subtask!.acceptanceCriteria).toBe(
        "- Feature works correctly\n- Tests pass"
      );
      expect(subtask!.tasksChecklist).toBe(
        "- [ ] Write code\n- [ ] Write tests"
      );
    });
  });

  describe("getPlanContent", () => {
    it("should return null for non-existent plan", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const content = await storage.getPlanContent("my-task");
      expect(content).toBeNull();
    });

    it("should return plan content", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      await storage.createPlan("my-task", {
        frontmatter: {
          status: "INPROGRESS",
          task: "my-task",
          created: new Date()
        },
        subtasks: []
      });
      await storage.updatePlanContent(
        "my-task",
        "## Execution Plan\n\n1. Do this\n2. Do that"
      );

      const content = await storage.getPlanContent("my-task");

      expect(content).toBe("## Execution Plan\n\n1. Do this\n2. Do that");
    });
  });

  describe("createTaskWithContent", () => {
    it("should create a task with full content", async () => {
      const taskData: TaskWithContent = {
        folder: "new-task",
        frontmatter: {
          title: "New Task",
          status: "PENDING",
          created: new Date("2026-01-01"),
          priority: "high",
          tags: ["feature"],
          assignee: null,
          dependencies: [],
          startedAt: null,
          completedAt: null,
          durationMs: null
        },
        description: "Task description here",
        requirements: "Requirements text",
        acceptanceCriteria: ["Criterion 1", "Criterion 2"],
        notes: "Some notes"
      };

      await storage.createTaskWithContent(taskData);

      const retrieved = await storage.getTaskWithContent("new-task");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.folder).toBe("new-task");
      expect(retrieved!.frontmatter.title).toBe("New Task");
      expect(retrieved!.description).toBe("Task description here");
      expect(retrieved!.requirements).toBe("Requirements text");
      expect(retrieved!.acceptanceCriteria).toEqual([
        "Criterion 1",
        "Criterion 2"
      ]);
      expect(retrieved!.notes).toBe("Some notes");
    });

    it("should emit taskChanged event", async () => {
      const events: { taskFolder: string }[] = [];
      storage.on("taskChanged", (e) => events.push(e));

      await storage.createTaskWithContent({
        folder: "new-task",
        frontmatter: {
          title: "New Task",
          status: "PENDING",
          created: new Date(),
          priority: "medium",
          tags: [],
          assignee: null,
          dependencies: [],
          startedAt: null,
          completedAt: null,
          durationMs: null
        },
        description: "Description",
        acceptanceCriteria: []
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.taskFolder).toBe("new-task");
    });
  });

  describe("createSubtaskWithContent", () => {
    it("should create a subtask with full content", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const subtaskData: SubtaskWithContent = {
        filename: "001-implement.md",
        frontmatter: {
          title: "Implement feature",
          status: "PENDING",
          dependencies: []
        },
        objective: "Main objective text",
        acceptanceCriteria: "- Works correctly",
        tasksChecklist: "- [ ] Step 1"
      };

      const filename = await storage.createSubtaskWithContent(
        "my-task",
        subtaskData
      );

      const retrieved = await storage.getSubtaskWithContent(
        "my-task",
        filename
      );
      expect(retrieved).not.toBeNull();
      expect(retrieved!.objective).toBe("Main objective text");
      expect(retrieved!.acceptanceCriteria).toBe("- Works correctly");
      expect(retrieved!.tasksChecklist).toBe("- [ ] Step 1");
    });

    it("should auto-generate filename if not provided", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      const filename = await storage.createSubtaskWithContent("my-task", {
        filename: "",
        frontmatter: {
          title: "Auto named subtask",
          status: "PENDING",
          dependencies: []
        },
        objective: "Objective"
      });

      expect(filename).toBe("001-auto-named-subtask.md");
    });

    it("should emit subtaskChanged event", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const events: { taskFolder: string; filename: string }[] = [];
      storage.on("subtaskChanged", (e) => events.push(e));

      await storage.createSubtaskWithContent("my-task", {
        filename: "",
        frontmatter: {
          title: "New subtask",
          status: "PENDING",
          dependencies: []
        },
        objective: "Objective"
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.taskFolder).toBe("my-task");
    });
  });

  describe("updateTaskContent", () => {
    it("should update task description", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      await storage.updateTaskContent("my-task", {
        description: "Updated description"
      });

      const task = await storage.getTaskWithContent("my-task");
      expect(task!.description).toBe("Updated description");
    });

    it("should update multiple content fields", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      await storage.updateTaskContent("my-task", {
        description: "New description",
        requirements: "New requirements",
        notes: "New notes"
      });

      const task = await storage.getTaskWithContent("my-task");
      expect(task!.description).toBe("New description");
      expect(task!.requirements).toBe("New requirements");
      expect(task!.notes).toBe("New notes");
    });

    it("should update acceptance criteria", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));

      await storage.updateTaskContent("my-task", {
        acceptanceCriteria: ["New criterion 1", "New criterion 2"]
      });

      const task = await storage.getTaskWithContent("my-task");
      expect(task!.acceptanceCriteria).toEqual([
        "New criterion 1",
        "New criterion 2"
      ]);
    });

    it("should emit taskChanged event", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const events: { taskFolder: string }[] = [];
      storage.on("taskChanged", (e) => events.push(e));

      await storage.updateTaskContent("my-task", { description: "Updated" });

      expect(events).toHaveLength(1);
    });
  });

  describe("updateSubtaskContent", () => {
    it("should update subtask objective", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const filename = await storage.createSubtask("my-task", {
        frontmatter: { title: "Test", status: "PENDING" },
        description: "Test"
      });

      await storage.updateSubtaskContent("my-task", filename, {
        objective: "Updated objective"
      });

      const subtask = await storage.getSubtaskWithContent("my-task", filename);
      expect(subtask!.objective).toBe("Updated objective");
    });

    it("should update multiple content fields", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const filename = await storage.createSubtask("my-task", {
        frontmatter: { title: "Test", status: "PENDING" },
        description: "Test"
      });

      await storage.updateSubtaskContent("my-task", filename, {
        objective: "New objective",
        acceptanceCriteria: "- Criterion 1\n- Criterion 2",
        tasksChecklist: "- [ ] Task 1",
        result: "Completed successfully"
      });

      const subtask = await storage.getSubtaskWithContent("my-task", filename);
      expect(subtask!.objective).toBe("New objective");
      expect(subtask!.acceptanceCriteria).toBe("- Criterion 1\n- Criterion 2");
      expect(subtask!.tasksChecklist).toBe("- [ ] Task 1");
      expect(subtask!.result).toBe("Completed successfully");
    });

    it("should emit subtaskChanged event", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      const filename = await storage.createSubtask("my-task", {
        frontmatter: { title: "Test", status: "PENDING" },
        description: "Test"
      });

      const events: { taskFolder: string; filename: string }[] = [];
      storage.on("subtaskChanged", (e) => events.push(e));

      await storage.updateSubtaskContent("my-task", filename, {
        objective: "Updated"
      });

      expect(events).toHaveLength(1);
    });
  });

  describe("updatePlanContent", () => {
    it("should update plan content", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      await storage.createPlan("my-task", {
        frontmatter: {
          status: "INPROGRESS",
          task: "my-task",
          created: new Date()
        },
        subtasks: []
      });

      await storage.updatePlanContent(
        "my-task",
        "# New Plan Content\n\nDetails here"
      );

      const content = await storage.getPlanContent("my-task");
      expect(content).toBe("# New Plan Content\n\nDetails here");
    });

    it("should emit planChanged event", async () => {
      await storage.createTask("my-task", createTestTask("my-task"));
      await storage.createPlan("my-task", {
        frontmatter: {
          status: "INPROGRESS",
          task: "my-task",
          created: new Date()
        },
        subtasks: []
      });

      const events: { taskFolder: string }[] = [];
      storage.on("planChanged", (e) => events.push(e));

      await storage.updatePlanContent("my-task", "Updated content");

      expect(events).toHaveLength(1);
    });
  });
});
