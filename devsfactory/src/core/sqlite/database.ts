import { Database, type SQLQueryBindings } from "bun:sqlite";
import { join } from "node:path";
import { getGlobalDir } from "../global-bootstrap";

const SCHEMA_SQL = `
-- Projects table (replaces ~/.aop/projects/*.yaml)
CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  git_remote TEXT,
  registered_at TEXT NOT NULL,
  settings TEXT,
  providers TEXT
);

-- Tasks table (replaces .devsfactory/*/task.md per project)
CREATE TABLE IF NOT EXISTS tasks (
  project_name TEXT NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
  folder TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  tags TEXT,
  assignee TEXT,
  dependencies TEXT,
  branch TEXT,
  description TEXT NOT NULL,
  requirements TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (project_name, folder)
);

-- Subtasks table (replaces .devsfactory/*/001-*.md)
CREATE TABLE IF NOT EXISTS subtasks (
  project_name TEXT NOT NULL,
  task_folder TEXT NOT NULL,
  filename TEXT NOT NULL,
  number INTEGER NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  dependencies TEXT,
  description TEXT NOT NULL,
  context TEXT,
  objective TEXT,
  acceptance_criteria TEXT,
  tasks_checklist TEXT,
  result TEXT,
  review TEXT,
  blockers TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  phase_implementation_ms INTEGER,
  phase_review_ms INTEGER,
  phase_merge_ms INTEGER,
  phase_conflict_solver_ms INTEGER,
  PRIMARY KEY (project_name, task_folder, filename),
  FOREIGN KEY (project_name, task_folder)
    REFERENCES tasks(project_name, folder) ON DELETE CASCADE
);

-- Plans table (replaces .devsfactory/*/plan.md)
CREATE TABLE IF NOT EXISTS plans (
  project_name TEXT NOT NULL,
  task_folder TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  subtask_refs TEXT NOT NULL,
  content TEXT,
  PRIMARY KEY (project_name, task_folder),
  FOREIGN KEY (project_name, task_folder)
    REFERENCES tasks(project_name, folder) ON DELETE CASCADE
);

-- Brainstorms table (replaces ~/.aop/brainstorm/ files)
CREATE TABLE IF NOT EXISTS brainstorms (
  project_name TEXT NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  messages TEXT,
  partial_task_data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_name, name)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_name);
CREATE INDEX IF NOT EXISTS idx_subtasks_status ON subtasks(status);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(project_name, task_folder);
CREATE INDEX IF NOT EXISTS idx_brainstorms_project ON brainstorms(project_name);
CREATE INDEX IF NOT EXISTS idx_brainstorms_status ON brainstorms(status);
`;

export class AopDatabase {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.runMigrations();
  }

  private runMigrations(): void {
    this.db.exec(SCHEMA_SQL);
    this.runColumnMigrations();
  }

  private runColumnMigrations(): void {
    const addColumnIfNotExists = (
      table: string,
      column: string,
      type: string
    ): void => {
      const columns = this.query<{ name: string }>(
        `PRAGMA table_info(${table})`
      );
      if (!columns.some((c) => c.name === column)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      }
    };

    addColumnIfNotExists("subtasks", "objective", "TEXT");
    addColumnIfNotExists("subtasks", "acceptance_criteria", "TEXT");
    addColumnIfNotExists("subtasks", "tasks_checklist", "TEXT");
    addColumnIfNotExists("plans", "content", "TEXT");
  }

  query<T>(sql: string, params: SQLQueryBindings[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  queryOne<T>(sql: string, params: SQLQueryBindings[] = []): T | null {
    const stmt = this.db.prepare(sql);
    return (stmt.get(...params) as T) ?? null;
  }

  run(sql: string, params: SQLQueryBindings[] = []): void {
    const stmt = this.db.prepare(sql);
    stmt.run(...params);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}

let instance: AopDatabase | null = null;

export const getDatabase = (dbPath?: string): AopDatabase => {
  if (!instance) {
    const path = dbPath ?? join(getGlobalDir(), "aop.db");
    instance = new AopDatabase(path);
  }
  return instance;
};

export const closeDatabase = (): void => {
  if (instance) {
    instance.close();
    instance = null;
  }
};

export const resetDatabaseInstance = (): void => {
  instance = null;
};
