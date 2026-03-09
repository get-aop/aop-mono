import type {
  Execution,
  ExecutionUpdate,
  NewExecution,
  NewStepExecution,
  NewStepLog,
  StepExecution,
  StepExecutionUpdate,
  StepLog,
} from "../db/schema.ts";

export interface ExecutionRepository {
  createExecution: (execution: NewExecution) => Promise<Execution>;
  getExecution: (id: string) => Promise<Execution | null>;
  updateExecution: (id: string, updates: ExecutionUpdate) => Promise<Execution | null>;
  getExecutionsByTaskId: (taskId: string) => Promise<Execution[]>;
  cancelRunningExecutions: () => Promise<number>;

  createStepExecution: (step: NewStepExecution) => Promise<StepExecution>;
  getStepExecution: (id: string) => Promise<StepExecution | null>;
  updateStepExecution: (id: string, updates: StepExecutionUpdate) => Promise<StepExecution | null>;
  getStepExecutionsByExecutionId: (executionId: string) => Promise<StepExecution[]>;
  getLatestStepExecution: (taskId: string) => Promise<StepExecution | null>;
  cancelRunningStepExecutions: () => Promise<number>;
  getRunningStepExecutions: () => Promise<(StepExecution & { task_id: string })[]>;

  saveStepLogs: (logs: NewStepLog[]) => Promise<void>;
  getStepLogs: (stepExecutionId: string) => Promise<StepLog[]>;
  getStepLogCount: (stepExecutionId: string) => Promise<number>;
  getStepLogsByExecutionId: (executionId: string) => Promise<StepLog[]>;
}

export const createExecutionRepository = (_legacyDb?: unknown): ExecutionRepository => {
  const executions = new Map<string, Execution>();
  const steps = new Map<string, StepExecution>();
  const logs = new Map<string, StepLog[]>();

  return {
    createExecution: async (execution: NewExecution): Promise<Execution> => {
      const record: Execution = {
        ...execution,
        completed_at: execution.completed_at ?? null,
      };
      executions.set(record.id, record);
      return record;
    },

    getExecution: async (id: string): Promise<Execution | null> => executions.get(id) ?? null,

    updateExecution: async (id: string, updates: ExecutionUpdate): Promise<Execution | null> => {
      const existing = executions.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      executions.set(id, updated);
      return updated;
    },

    getExecutionsByTaskId: async (taskId: string): Promise<Execution[]> =>
      [...executions.values()]
        .filter((execution) => execution.task_id === taskId)
        .sort((left, right) => right.started_at.localeCompare(left.started_at)),

    cancelRunningExecutions: async (): Promise<number> => {
      const running = [...executions.values()].filter((execution) => execution.status === "running");
      const now = new Date().toISOString();
      for (const execution of running) {
        executions.set(execution.id, { ...execution, status: "cancelled", completed_at: now });
      }
      return running.length;
    },

    createStepExecution: async (step: NewStepExecution): Promise<StepExecution> => {
      const record: StepExecution = {
        ...step,
        step_id: step.step_id ?? null,
        step_type: step.step_type ?? null,
        remote_execution_id: step.remote_execution_id ?? null,
        agent_pid: step.agent_pid ?? null,
        session_id: step.session_id ?? null,
        exit_code: step.exit_code ?? null,
        signal: step.signal ?? null,
        pause_context: step.pause_context ?? null,
        error: step.error ?? null,
        attempt: step.attempt ?? null,
        iteration: step.iteration ?? null,
        signals_json: step.signals_json ?? null,
        ended_at: step.ended_at ?? null,
      };
      steps.set(record.id, record);
      return record;
    },

    getStepExecution: async (id: string): Promise<StepExecution | null> => steps.get(id) ?? null,

    updateStepExecution: async (
      id: string,
      updates: StepExecutionUpdate,
    ): Promise<StepExecution | null> => {
      const existing = steps.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      steps.set(id, updated);
      return updated;
    },

    getStepExecutionsByExecutionId: async (executionId: string): Promise<StepExecution[]> =>
      [...steps.values()]
        .filter((step) => step.execution_id === executionId)
        .sort((left, right) => left.started_at.localeCompare(right.started_at)),

    getLatestStepExecution: async (taskId: string): Promise<StepExecution | null> => {
      const executionIds = new Set(
        [...executions.values()]
          .filter((execution) => execution.task_id === taskId)
          .map((execution) => execution.id),
      );

      return (
        [...steps.values()]
          .filter((step) => executionIds.has(step.execution_id))
          .sort((left, right) => right.started_at.localeCompare(left.started_at))[0] ?? null
      );
    },

    cancelRunningStepExecutions: async (): Promise<number> => {
      const running = [...steps.values()].filter((step) => step.status === "running");
      const now = new Date().toISOString();
      for (const step of running) {
        steps.set(step.id, { ...step, status: "cancelled", ended_at: now });
      }
      return running.length;
    },

    getRunningStepExecutions: async (): Promise<(StepExecution & { task_id: string })[]> => {
      return [...steps.values()]
        .filter((step) => step.status === "running")
        .map((step) => {
          const execution = executions.get(step.execution_id);
          return execution ? { ...step, task_id: execution.task_id } : null;
        })
        .filter((step): step is StepExecution & { task_id: string } => step !== null);
    },

    saveStepLogs: async (entries: NewStepLog[]): Promise<void> => {
      for (const entry of entries) {
        const existing = logs.get(entry.step_execution_id) ?? [];
        existing.push({
          id: existing.length + 1,
          step_execution_id: entry.step_execution_id,
          content: entry.content,
          created_at: entry.created_at,
        });
        logs.set(entry.step_execution_id, existing);
      }
    },

    getStepLogs: async (stepExecutionId: string): Promise<StepLog[]> =>
      logs.get(stepExecutionId) ?? [],

    getStepLogCount: async (stepExecutionId: string): Promise<number> =>
      (logs.get(stepExecutionId) ?? []).length,

    getStepLogsByExecutionId: async (executionId: string): Promise<StepLog[]> => {
      const executionSteps = [...steps.values()]
        .filter((step) => step.execution_id === executionId)
        .sort((left, right) => left.started_at.localeCompare(right.started_at));

      return executionSteps.flatMap((step) => logs.get(step.id) ?? []);
    },
  };
};
