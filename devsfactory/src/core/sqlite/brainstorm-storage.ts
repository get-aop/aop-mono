import type {
  BrainstormMessage,
  BrainstormSessionStatus,
  TaskPreview
} from "../../types";
import { type AopDatabase, getDatabase } from "./database";

export interface BrainstormRecord {
  projectName: string;
  name: string;
  status: BrainstormSessionStatus;
  messages: BrainstormMessage[];
  partialTaskData: Partial<TaskPreview>;
  createdAt: Date;
  updatedAt: Date;
}

interface BrainstormRow {
  project_name: string;
  name: string;
  status: string;
  messages: string | null;
  partial_task_data: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrainstormUpdateData {
  status?: BrainstormSessionStatus;
  messages?: BrainstormMessage[];
  partialTaskData?: Partial<TaskPreview>;
}

export interface SQLiteBrainstormStorageOptions {
  projectName: string;
  db?: AopDatabase;
}

const parseMessages = (json: string | null): BrainstormMessage[] => {
  if (!json) return [];
  const parsed = JSON.parse(json);
  return parsed.map((msg: BrainstormMessage) => ({
    ...msg,
    timestamp: new Date(msg.timestamp)
  }));
};

const parseTaskData = (json: string | null): Partial<TaskPreview> => {
  if (!json) return {};
  return JSON.parse(json);
};

const rowToRecord = (row: BrainstormRow): BrainstormRecord => ({
  projectName: row.project_name,
  name: row.name,
  status: row.status as BrainstormSessionStatus,
  messages: parseMessages(row.messages),
  partialTaskData: parseTaskData(row.partial_task_data),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at)
});

export class SQLiteBrainstormStorage {
  private db: AopDatabase;
  private projectName: string;

  constructor(options: SQLiteBrainstormStorageOptions) {
    this.db = options.db ?? getDatabase();
    this.projectName = options.projectName;
  }

  async create(name: string): Promise<BrainstormRecord> {
    const now = new Date();
    this.db.run(
      `INSERT INTO brainstorms (project_name, name, status, messages, partial_task_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        this.projectName,
        name,
        "active",
        "[]",
        "{}",
        now.toISOString(),
        now.toISOString()
      ]
    );

    return {
      projectName: this.projectName,
      name,
      status: "active",
      messages: [],
      partialTaskData: {},
      createdAt: now,
      updatedAt: now
    };
  }

  async get(name: string): Promise<BrainstormRecord | null> {
    const row = this.db.queryOne<BrainstormRow>(
      "SELECT * FROM brainstorms WHERE project_name = ? AND name = ?",
      [this.projectName, name]
    );
    return row ? rowToRecord(row) : null;
  }

  async getActive(): Promise<BrainstormRecord | null> {
    const row = this.db.queryOne<BrainstormRow>(
      `SELECT * FROM brainstorms
       WHERE project_name = ? AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [this.projectName]
    );
    return row ? rowToRecord(row) : null;
  }

  async update(name: string, data: BrainstormUpdateData): Promise<void> {
    const existing = await this.get(name);
    if (!existing) {
      throw new Error(`Brainstorm session '${name}' not found`);
    }

    const setClauses: string[] = ["updated_at = ?"];
    const params: (string | null)[] = [new Date().toISOString()];

    if (data.status !== undefined) {
      setClauses.push("status = ?");
      params.push(data.status);
    }

    if (data.messages !== undefined) {
      setClauses.push("messages = ?");
      params.push(JSON.stringify(data.messages));
    }

    if (data.partialTaskData !== undefined) {
      setClauses.push("partial_task_data = ?");
      params.push(JSON.stringify(data.partialTaskData));
    }

    params.push(this.projectName, name);
    this.db.run(
      `UPDATE brainstorms SET ${setClauses.join(", ")} WHERE project_name = ? AND name = ?`,
      params
    );
  }

  async list(): Promise<BrainstormRecord[]> {
    const rows = this.db.query<BrainstormRow>(
      "SELECT * FROM brainstorms WHERE project_name = ? ORDER BY updated_at DESC",
      [this.projectName]
    );
    return rows.map(rowToRecord);
  }

  async delete(name: string): Promise<void> {
    this.db.run("DELETE FROM brainstorms WHERE project_name = ? AND name = ?", [
      this.projectName,
      name
    ]);
  }

  async addMessage(name: string, message: BrainstormMessage): Promise<void> {
    const existing = await this.get(name);
    if (!existing) {
      throw new Error(`Brainstorm session '${name}' not found`);
    }

    const messages = [...existing.messages, message];
    await this.update(name, { messages });
  }
}
