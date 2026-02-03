import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AopDatabase, resetDatabaseInstance } from "./database";

describe("AopDatabase", () => {
  let tempDir: string;
  let db: AopDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aop-database-test-"));
    const dbPath = join(tempDir, "test.db");
    db = new AopDatabase(dbPath);
  });

  afterEach(async () => {
    db.close();
    resetDatabaseInstance();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("schema migrations", () => {
    const getColumnNames = (tableName: string): string[] => {
      const rows = db.query<{ name: string }>(
        `PRAGMA table_info(${tableName})`
      );
      return rows.map((r) => r.name);
    };

    describe("subtasks table", () => {
      it("should have objective column", () => {
        const columns = getColumnNames("subtasks");
        expect(columns).toContain("objective");
      });

      it("should have acceptance_criteria column", () => {
        const columns = getColumnNames("subtasks");
        expect(columns).toContain("acceptance_criteria");
      });

      it("should have tasks_checklist column", () => {
        const columns = getColumnNames("subtasks");
        expect(columns).toContain("tasks_checklist");
      });
    });

    describe("plans table", () => {
      it("should have content column", () => {
        const columns = getColumnNames("plans");
        expect(columns).toContain("content");
      });
    });

    describe("brainstorms table", () => {
      it("should exist with required columns", () => {
        const columns = getColumnNames("brainstorms");
        expect(columns).toContain("project_name");
        expect(columns).toContain("name");
        expect(columns).toContain("status");
        expect(columns).toContain("messages");
        expect(columns).toContain("partial_task_data");
        expect(columns).toContain("created_at");
        expect(columns).toContain("updated_at");
      });

      it("should have project_name and name as primary key", () => {
        const rows = db.query<{ pk: number; name: string }>(
          "PRAGMA table_info(brainstorms)"
        );
        const pkColumns = rows.filter((r) => r.pk > 0).map((r) => r.name);
        expect(pkColumns).toContain("project_name");
        expect(pkColumns).toContain("name");
      });

      it("should have foreign key to projects table", () => {
        const fks = db.query<{ table: string; from: string; to: string }>(
          "PRAGMA foreign_key_list(brainstorms)"
        );
        const projectFk = fks.find((fk) => fk.table === "projects");
        expect(projectFk).toBeDefined();
        expect(projectFk!.from).toBe("project_name");
        expect(projectFk!.to).toBe("name");
      });
    });

    describe("idempotency", () => {
      it("should be safe to run migrations multiple times", () => {
        const dbPath = join(tempDir, "test-idempotent.db");
        const db1 = new AopDatabase(dbPath);
        db1.close();

        const db2 = new AopDatabase(dbPath);
        const columns = db2.query<{ name: string }>(
          "PRAGMA table_info(subtasks)"
        );
        db2.close();

        expect(columns.map((c) => c.name)).toContain("objective");
      });
    });
  });
});
