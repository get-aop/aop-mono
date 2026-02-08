import { Database as SQLiteDatabase } from "bun:sqlite";
import { aopPaths } from "@aop/infra";

export interface LocalStepExecution {
  id: string;
  execution_id: string;
  step_type: string | null;
  agent_pid: number | null;
  status: string;
  exit_code: number | null;
  signal: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface LocalExecution {
  id: string;
  task_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
}

const openDb = (): SQLiteDatabase => {
  const dbPath = process.env.AOP_DB_PATH ?? aopPaths.db();
  return new SQLiteDatabase(dbPath, { readonly: true });
};

export const getLocalStepExecutions = (executionId: string): LocalStepExecution[] => {
  const db = openDb();
  try {
    return db
      .query<LocalStepExecution, [string]>(
        "SELECT id, execution_id, step_type, agent_pid, status, exit_code, signal, error, started_at, ended_at FROM step_executions WHERE execution_id = ? ORDER BY started_at ASC",
      )
      .all(executionId);
  } finally {
    db.close();
  }
};

export const getLocalExecution = (executionId: string): LocalExecution | null => {
  const db = openDb();
  try {
    return (
      db
        .query<LocalExecution, [string]>(
          "SELECT id, task_id, status, started_at, completed_at FROM executions WHERE id = ?",
        )
        .get(executionId) ?? null
    );
  } finally {
    db.close();
  }
};

export const getLocalExecutionsByTaskId = (taskId: string): LocalExecution[] => {
  const db = openDb();
  try {
    return db
      .query<LocalExecution, [string]>(
        "SELECT id, task_id, status, started_at, completed_at FROM executions WHERE task_id = ? ORDER BY started_at DESC",
      )
      .all(taskId);
  } finally {
    db.close();
  }
};

export const getLocalStepExecutionsByTaskId = (taskId: string): LocalStepExecution[] => {
  const db = openDb();
  try {
    return db
      .query<LocalStepExecution, [string]>(
        `SELECT se.id, se.execution_id, se.step_type, se.agent_pid, se.status, se.exit_code, se.signal, se.error, se.started_at, se.ended_at
         FROM step_executions se
         INNER JOIN executions e ON e.id = se.execution_id
         WHERE e.task_id = ?
         ORDER BY se.started_at ASC`,
      )
      .all(taskId);
  } finally {
    db.close();
  }
};

export interface WaitForLocalStepOptions {
  timeout?: number;
  pollInterval?: number;
}

export const waitForLocalStepWithPid = async (
  taskId: string,
  options: WaitForLocalStepOptions = {},
): Promise<LocalStepExecution | null> => {
  const { timeout = 60_000, pollInterval = 1000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const steps = getLocalStepExecutionsByTaskId(taskId);
    const stepWithPid = steps.find((s) => s.agent_pid !== null && s.status === "running");
    if (stepWithPid) return stepWithPid;
    await Bun.sleep(pollInterval);
  }

  return null;
};
