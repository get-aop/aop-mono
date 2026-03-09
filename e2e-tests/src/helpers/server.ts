import type { Database } from "@aop/server/db";
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { API_KEY, SERVER_URL } from "./constants";

export interface DevEnvironmentCheck {
  ready: boolean;
  reason?: string;
}

export const checkDevEnvironment = async (
  serverUrl?: string,
  apiKey?: string,
): Promise<DevEnvironmentCheck> => {
  const url = serverUrl ?? SERVER_URL;
  const key = apiKey ?? API_KEY;
  try {
    const healthResponse = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!healthResponse.ok) {
      return { ready: false, reason: `Server health check failed: ${healthResponse.status}` };
    }

    const authResponse = await fetch(`${url}/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
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

export const getServerTaskStatus = async (
  taskId: string,
  serverUrl?: string,
  apiKey?: string,
): Promise<ServerTaskStatus | null> => {
  const url = serverUrl ?? SERVER_URL;
  const key = apiKey ?? API_KEY;
  try {
    const response = await fetch(`${url}/tasks/${taskId}/status`, {
      headers: {
        Authorization: `Bearer ${key}`,
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
  serverUrl?: string;
  apiKey?: string;
}

export const waitForServerTaskStatus = async (
  taskId: string,
  targetStatus: string | string[],
  options: WaitForServerTaskOptions = {},
): Promise<ServerTaskStatus | null> => {
  const { timeout = 60_000, pollInterval = 2000, serverUrl, apiKey } = options;
  const statuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const status = await getServerTaskStatus(taskId, serverUrl, apiKey);
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
  serverUrl?: string,
  apiKey?: string,
): Promise<ServerExecutionStatus | null> => {
  const taskStatus = await getServerTaskStatus(taskId, serverUrl, apiKey);
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
  step_id: string | null;
  step_type: string;
  status: string;
  signal: string | null;
}

export const getStepExecutionsForTask = async (
  taskId: string,
  pgDatabaseUrl?: string,
): Promise<StepExecutionInfo[]> => {
  const dbUrl = pgDatabaseUrl ?? (process.env.AOP_DATABASE_URL as string);
  const pg = postgres(dbUrl, { max: 5, idle_timeout: 20 });
  const db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: pg }) });

  try {
    const rows = await db
      .selectFrom("step_executions as se")
      .innerJoin("executions as e", "se.execution_id", "e.id")
      .select(["se.id", "se.execution_id", "se.step_id", "se.step_type", "se.status", "se.signal"])
      .where("e.task_id", "=", taskId)
      .orderBy("se.started_at", "asc")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      execution_id: row.execution_id,
      step_id: row.step_id,
      step_type: row.step_type,
      status: row.status,
      signal: row.signal,
    }));
  } finally {
    await pg.end();
  }
};
