import type { PhaseTimings } from "../types";
import { SQLiteTaskStorage } from "./sqlite/sqlite-task-storage";
import { detectBottleneck } from "./timing";

export interface SubtaskStats {
  number: number;
  title: string;
  durationMs: number | null;
  phases: PhaseTimings;
}

export interface TaskStatsSummary {
  totalSubtasks: number;
  completedSubtasks: number;
  averageDurationMs: number;
  slowestPhase: string | null;
  slowestPhasePercent: number | null;
}

export interface TaskStats {
  task: string;
  taskFolder: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  subtasks: SubtaskStats[];
  summary: TaskStatsSummary;
}

const DEFAULT_PHASES: PhaseTimings = {
  implementation: null,
  review: null,
  merge: null,
  conflictSolver: null
};

export const exportTaskStats = async (
  taskFolder: string,
  projectName: string
): Promise<TaskStats> => {
  const storage = new SQLiteTaskStorage({ projectName });
  const task = await storage.getTask(taskFolder);
  if (!task) {
    throw new Error(`Task '${taskFolder}' not found`);
  }
  const subtasks = await storage.listSubtasks(taskFolder);

  const subtaskStats: SubtaskStats[] = subtasks.map((subtask) => ({
    number: subtask.number,
    title: subtask.frontmatter.title,
    durationMs: subtask.frontmatter.timing?.durationMs ?? null,
    phases: subtask.frontmatter.timing?.phases ?? DEFAULT_PHASES
  }));

  const completedSubtasks = subtasks.filter(
    (s) => s.frontmatter.status === "DONE"
  );

  const completedWithDuration = completedSubtasks.filter(
    (s) => s.frontmatter.timing?.durationMs != null
  );

  const totalDuration = completedWithDuration.reduce(
    (sum, s) => sum + (s.frontmatter.timing?.durationMs ?? 0),
    0
  );

  const averageDurationMs =
    completedWithDuration.length > 0
      ? Math.round(totalDuration / completedWithDuration.length)
      : 0;

  const aggregatedPhases = aggregatePhaseDurations(subtaskStats);
  const bottleneck = detectBottleneck(aggregatedPhases);

  return {
    task: task.frontmatter.title,
    taskFolder,
    startedAt: task.frontmatter.startedAt?.toISOString() ?? null,
    completedAt: task.frontmatter.completedAt?.toISOString() ?? null,
    durationMs: task.frontmatter.durationMs ?? null,
    subtasks: subtaskStats,
    summary: {
      totalSubtasks: subtasks.length,
      completedSubtasks: completedSubtasks.length,
      averageDurationMs,
      slowestPhase: bottleneck?.phase ?? null,
      slowestPhasePercent: bottleneck?.percent ?? null
    }
  };
};

const PHASE_KEYS: (keyof PhaseTimings)[] = [
  "implementation",
  "review",
  "merge",
  "conflictSolver"
];

const aggregatePhaseDurations = (subtasks: SubtaskStats[]): PhaseTimings => {
  const totals: Record<keyof PhaseTimings, number> = {
    implementation: 0,
    review: 0,
    merge: 0,
    conflictSolver: 0
  };

  for (const { phases } of subtasks) {
    for (const phase of PHASE_KEYS) {
      const value = phases[phase];
      if (value !== null) {
        totals[phase] += value;
      }
    }
  }

  const hasData = Object.values(totals).some((v) => v !== 0);
  if (!hasData) return DEFAULT_PHASES;

  return totals;
};
