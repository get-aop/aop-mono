import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrainstormMessage, TaskPreview } from "../../types";
import { SQLiteBrainstormStorage } from "./brainstorm-storage";
import { AopDatabase, resetDatabaseInstance } from "./database";

describe("SQLiteBrainstormStorage", () => {
  let tempDir: string;
  let db: AopDatabase;
  let storage: SQLiteBrainstormStorage;
  const projectName = "test-project";

  const createTestMessage = (
    overrides?: Partial<BrainstormMessage>
  ): BrainstormMessage => ({
    id: "msg-1",
    role: "user",
    content: "Test message",
    timestamp: new Date("2026-01-01T10:00:00Z"),
    ...overrides
  });

  const createPartialTaskData = (): Partial<TaskPreview> => ({
    title: "Test Task",
    description: "A test description"
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sqlite-brainstorm-storage-test-"));
    const dbPath = join(tempDir, "test.db");
    db = new AopDatabase(dbPath);

    db.run(
      `INSERT INTO projects (name, path, registered_at) VALUES (?, ?, ?)`,
      [projectName, "/path/to/project", new Date().toISOString()]
    );

    storage = new SQLiteBrainstormStorage({ projectName, db });
  });

  afterEach(async () => {
    db.close();
    resetDatabaseInstance();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("should create a new brainstorm session", async () => {
      const record = await storage.create("my-session");

      expect(record).not.toBeNull();
      expect(record.projectName).toBe(projectName);
      expect(record.name).toBe("my-session");
      expect(record.status).toBe("active");
      expect(record.messages).toEqual([]);
      expect(record.partialTaskData).toEqual({});
      expect(record.createdAt).toBeInstanceOf(Date);
      expect(record.updatedAt).toBeInstanceOf(Date);
    });

    it("should throw when creating duplicate session", async () => {
      await storage.create("my-session");

      expect(storage.create("my-session")).rejects.toThrow();
    });
  });

  describe("get", () => {
    it("should return null for non-existent session", async () => {
      const record = await storage.get("non-existent");
      expect(record).toBeNull();
    });

    it("should return session with all fields", async () => {
      await storage.create("my-session");
      await storage.update("my-session", {
        status: "brainstorming",
        messages: [createTestMessage()],
        partialTaskData: createPartialTaskData()
      });

      const record = await storage.get("my-session");

      expect(record).not.toBeNull();
      expect(record!.name).toBe("my-session");
      expect(record!.status).toBe("brainstorming");
      expect(record!.messages).toHaveLength(1);
      expect(record!.messages[0]!.content).toBe("Test message");
      expect(record!.partialTaskData.title).toBe("Test Task");
    });
  });

  describe("getActive", () => {
    it("should return null when no active session", async () => {
      const record = await storage.getActive();
      expect(record).toBeNull();
    });

    it("should return the active session", async () => {
      await storage.create("session-1");
      await storage.update("session-1", { status: "completed" });
      await storage.create("session-2");

      const active = await storage.getActive();

      expect(active).not.toBeNull();
      expect(active!.name).toBe("session-2");
      expect(active!.status).toBe("active");
    });

    it("should return the most recent active session if multiple exist", async () => {
      await storage.create("session-1");
      await Bun.sleep(10);
      await storage.create("session-2");

      const active = await storage.getActive();

      expect(active!.name).toBe("session-2");
    });

    it("should only return sessions for this project", async () => {
      await storage.create("my-session");
      await storage.update("my-session", { status: "completed" });

      db.run(
        `INSERT INTO projects (name, path, registered_at) VALUES (?, ?, ?)`,
        ["other-project", "/other/path", new Date().toISOString()]
      );
      db.run(
        `INSERT INTO brainstorms (project_name, name, status, messages, partial_task_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          "other-project",
          "other-session",
          "active",
          "[]",
          "{}",
          new Date().toISOString(),
          new Date().toISOString()
        ]
      );

      const active = await storage.getActive();

      expect(active).toBeNull();
    });
  });

  describe("update", () => {
    it("should update session status", async () => {
      await storage.create("my-session");

      await storage.update("my-session", { status: "brainstorming" });

      const record = await storage.get("my-session");
      expect(record!.status).toBe("brainstorming");
    });

    it("should update messages", async () => {
      await storage.create("my-session");

      await storage.update("my-session", {
        messages: [
          createTestMessage(),
          createTestMessage({ id: "msg-2", content: "Second" })
        ]
      });

      const record = await storage.get("my-session");
      expect(record!.messages).toHaveLength(2);
    });

    it("should update partialTaskData", async () => {
      await storage.create("my-session");

      await storage.update("my-session", {
        partialTaskData: {
          title: "Updated Task",
          description: "Updated description",
          requirements: "Some requirements"
        }
      });

      const record = await storage.get("my-session");
      expect(record!.partialTaskData.title).toBe("Updated Task");
      expect(record!.partialTaskData.requirements).toBe("Some requirements");
    });

    it("should update the updatedAt timestamp", async () => {
      await storage.create("my-session");
      const before = await storage.get("my-session");

      await Bun.sleep(10);
      await storage.update("my-session", { status: "brainstorming" });

      const after = await storage.get("my-session");
      expect(after!.updatedAt.getTime()).toBeGreaterThan(
        before!.updatedAt.getTime()
      );
    });

    it("should throw for non-existent session", async () => {
      expect(
        storage.update("non-existent", { status: "completed" })
      ).rejects.toThrow();
    });
  });

  describe("list", () => {
    it("should return empty array when no sessions", async () => {
      const records = await storage.list();
      expect(records).toEqual([]);
    });

    it("should return all sessions for the project", async () => {
      await storage.create("session-1");
      await storage.create("session-2");
      await storage.create("session-3");

      const records = await storage.list();

      expect(records).toHaveLength(3);
    });

    it("should return sessions sorted by updatedAt descending", async () => {
      await storage.create("session-1");
      await Bun.sleep(10);
      await storage.create("session-2");
      await Bun.sleep(10);
      await storage.create("session-3");

      await storage.update("session-1", { status: "brainstorming" });

      const records = await storage.list();

      expect(records[0]!.name).toBe("session-1");
      expect(records[1]!.name).toBe("session-3");
      expect(records[2]!.name).toBe("session-2");
    });

    it("should only return sessions for this project", async () => {
      await storage.create("my-session");

      db.run(
        `INSERT INTO projects (name, path, registered_at) VALUES (?, ?, ?)`,
        ["other-project", "/other/path", new Date().toISOString()]
      );
      db.run(
        `INSERT INTO brainstorms (project_name, name, status, messages, partial_task_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          "other-project",
          "other-session",
          "active",
          "[]",
          "{}",
          new Date().toISOString(),
          new Date().toISOString()
        ]
      );

      const records = await storage.list();

      expect(records).toHaveLength(1);
      expect(records[0]!.name).toBe("my-session");
    });
  });

  describe("delete", () => {
    it("should delete an existing session", async () => {
      await storage.create("my-session");

      await storage.delete("my-session");

      const record = await storage.get("my-session");
      expect(record).toBeNull();
    });

    it("should not throw when deleting non-existent session", async () => {
      await expect(storage.delete("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("addMessage", () => {
    it("should append a message to the session", async () => {
      await storage.create("my-session");

      await storage.addMessage("my-session", createTestMessage());

      const record = await storage.get("my-session");
      expect(record!.messages).toHaveLength(1);
      expect(record!.messages[0]!.content).toBe("Test message");
    });

    it("should append multiple messages in order", async () => {
      await storage.create("my-session");

      await storage.addMessage(
        "my-session",
        createTestMessage({ id: "msg-1", content: "First" })
      );
      await storage.addMessage(
        "my-session",
        createTestMessage({ id: "msg-2", content: "Second" })
      );
      await storage.addMessage(
        "my-session",
        createTestMessage({ id: "msg-3", content: "Third" })
      );

      const record = await storage.get("my-session");
      expect(record!.messages).toHaveLength(3);
      expect(record!.messages[0]!.content).toBe("First");
      expect(record!.messages[1]!.content).toBe("Second");
      expect(record!.messages[2]!.content).toBe("Third");
    });

    it("should update the updatedAt timestamp", async () => {
      await storage.create("my-session");
      const before = await storage.get("my-session");

      await Bun.sleep(10);
      await storage.addMessage("my-session", createTestMessage());

      const after = await storage.get("my-session");
      expect(after!.updatedAt.getTime()).toBeGreaterThan(
        before!.updatedAt.getTime()
      );
    });

    it("should throw for non-existent session", async () => {
      expect(
        storage.addMessage("non-existent", createTestMessage())
      ).rejects.toThrow();
    });
  });

  describe("session lifecycle", () => {
    it("should support full lifecycle: active → brainstorming → completed", async () => {
      const record = await storage.create("lifecycle-session");
      expect(record.status).toBe("active");

      await storage.update("lifecycle-session", { status: "brainstorming" });
      const brainstormingRecord = await storage.get("lifecycle-session");
      expect(brainstormingRecord!.status).toBe("brainstorming");

      await storage.update("lifecycle-session", {
        status: "completed",
        partialTaskData: {
          title: "Final Task",
          description: "Complete description"
        }
      });

      const completedRecord = await storage.get("lifecycle-session");
      expect(completedRecord!.status).toBe("completed");
      expect(completedRecord!.partialTaskData.title).toBe("Final Task");
    });

    it("should not return completed sessions from getActive", async () => {
      await storage.create("session-to-complete");

      const activeSession = await storage.getActive();
      expect(activeSession).not.toBeNull();

      await storage.update("session-to-complete", { status: "completed" });

      const noActiveSession = await storage.getActive();
      expect(noActiveSession).toBeNull();
    });

    it("should preserve messages and data through status transitions", async () => {
      await storage.create("transition-session");

      await storage.addMessage(
        "transition-session",
        createTestMessage({ content: "First message" })
      );
      await storage.update("transition-session", {
        partialTaskData: { title: "Initial Title" }
      });

      await storage.update("transition-session", { status: "brainstorming" });

      await storage.addMessage(
        "transition-session",
        createTestMessage({ id: "msg-2", content: "Second message" })
      );
      await storage.update("transition-session", {
        partialTaskData: { title: "Initial Title", description: "Added desc" }
      });

      await storage.update("transition-session", { status: "completed" });

      const finalRecord = await storage.get("transition-session");
      expect(finalRecord!.status).toBe("completed");
      expect(finalRecord!.messages).toHaveLength(2);
      expect(finalRecord!.partialTaskData.title).toBe("Initial Title");
      expect(finalRecord!.partialTaskData.description).toBe("Added desc");
    });
  });

  describe("JSON serialization", () => {
    it("should correctly serialize and deserialize messages with dates", async () => {
      await storage.create("my-session");
      const message = createTestMessage({
        timestamp: new Date("2026-06-15T14:30:00Z")
      });

      await storage.addMessage("my-session", message);

      const record = await storage.get("my-session");
      expect(record!.messages[0]!.timestamp).toEqual(
        new Date("2026-06-15T14:30:00Z")
      );
    });

    it("should correctly serialize and deserialize partialTaskData", async () => {
      await storage.create("my-session");
      const taskData: Partial<TaskPreview> = {
        title: "My Task",
        description: "Description",
        requirements: "Requirements",
        acceptanceCriteria: ["Criteria 1", "Criteria 2"]
      };

      await storage.update("my-session", { partialTaskData: taskData });

      const record = await storage.get("my-session");
      expect(record!.partialTaskData).toEqual(taskData);
    });
  });
});
