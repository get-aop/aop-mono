import type { Database } from "@aop/server/db";
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { API_KEY, SERVER_URL } from "./constants";

let serverDb: Kysely<Database> | null = null;

const getServerDb = (): Kysely<Database> => {
  if (!serverDb) {
    const databaseUrl = process.env.DATABASE_URL ?? "postgres://aop:aop@localhost:5433/aop";
    const pg = postgres(databaseUrl, { max: 5, idle_timeout: 20 });
    serverDb = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: pg }) });
  }
  return serverDb;
};

export interface DevEnvironmentCheck {
  ready: boolean;
  reason?: string;
}

export const checkDevEnvironment = async (): Promise<DevEnvironmentCheck> => {
  try {
    const healthResponse = await fetch(`${SERVER_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!healthResponse.ok) {
      return { ready: false, reason: `Server health check failed: ${healthResponse.status}` };
    }

    const authResponse = await fetch(`${SERVER_URL}/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000),
    });

    if (!authResponse.ok) {
      return { ready: false, reason: `Server auth failed: ${authResponse.status}` };
    }

    return { ready: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ready: false, reason: `Server connection failed: ${message}` };
  }
};

export interface ServerTaskStatus {
  status: string;
  execution?: {
    id: string;
    currentStepId?: string;
    awaitingResult?: boolean;
  };
}

export const getServerTaskStatus = async (taskId: string): Promise<ServerTaskStatus | null> => {
  try {
    const response = await fetch(`${SERVER_URL}/tasks/${taskId}/status`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as ServerTaskStatus;
  } catch {
    return null;
  }
};

export interface WaitForServerTaskOptions {
  timeout?: number;
  pollInterval?: number;
}

export const waitForServerTaskStatus = async (
  taskId: string,
  targetStatus: string | string[],
  options: WaitForServerTaskOptions = {},
): Promise<ServerTaskStatus | null> => {
  const { timeout = 60_000, pollInterval = 2000 } = options;
  const statuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const status = await getServerTaskStatus(taskId);
    if (status && statuses.includes(status.status)) {
      return status;
    }
    await Bun.sleep(pollInterval);
  }

  return null;
};

export interface ServerExecutionStatus {
  id: string;
  status: string;
  taskId: string;
  workflowId: string;
}

export const getServerExecutionStatus = async (
  taskId: string,
): Promise<ServerExecutionStatus | null> => {
  const taskStatus = await getServerTaskStatus(taskId);
  if (!taskStatus?.execution) {
    return null;
  }

  return {
    id: taskStatus.execution.id,
    status: taskStatus.execution.awaitingResult ? "running" : "completed",
    taskId,
    workflowId: "",
  };
};

export interface StepExecutionInfo {
  id: string;
  execution_id: string;
  step_type: string;
  status: string;
  signal: string | null;
}

export const getStepExecutionsForTask = async (taskId: string): Promise<StepExecutionInfo[]> => {
  const db = getServerDb();

  const rows = await db
    .selectFrom("step_executions as se")
    .innerJoin("executions as e", "se.execution_id", "e.id")
    .select(["se.id", "se.execution_id", "se.step_type", "se.status", "se.signal"])
    .where("e.task_id", "=", taskId)
    .orderBy("se.started_at", "asc")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    execution_id: row.execution_id,
    step_type: row.step_type,
    status: row.status,
    signal: row.signal,
  }));
};
