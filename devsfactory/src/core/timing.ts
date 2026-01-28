import type { PhaseTimings, Subtask, Task } from "../types";

export interface TaskSummary {
  taskTitle: string;
  totalDurationMs: number;
  subtaskCount: number;
  averageDurationMs: number;
  subtaskTimings: Array<{
    title: string;
    durationMs: number;
    phases: PhaseTimings;
  }>;
  bottleneck: { phase: string; percent: number } | null;
}

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return "< 1s";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours >= 1) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes >= 1) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
};

export const detectBottleneck = (
  phases: PhaseTimings,
  threshold = 0.5
): { phase: string; percent: number } | null => {
  const entries = Object.entries(phases).filter(
    (entry): entry is [string, number] => entry[1] !== null
  );

  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total === 0) return null;

  let maxPhase: { phase: string; percent: number } | null = null;

  for (const [phase, value] of entries) {
    const percent = Math.round((value / total) * 100);
    if (value / total >= threshold) {
      if (!maxPhase || percent > maxPhase.percent) {
        maxPhase = { phase, percent };
      }
    }
  }

  return maxPhase;
};

const DEFAULT_PHASES: PhaseTimings = {
  implementation: null,
  review: null,
  merge: null,
  conflictSolver: null
};

const PHASE_KEYS: (keyof PhaseTimings)[] = [
  "implementation",
  "review",
  "merge",
  "conflictSolver"
];

export const generateTaskSummary = (
  task: Task,
  subtasks: Subtask[]
): TaskSummary => {
  const subtaskTimings = subtasks.map((subtask) => ({
    title: subtask.frontmatter.title,
    durationMs: subtask.frontmatter.timing?.durationMs ?? 0,
    phases: subtask.frontmatter.timing?.phases ?? DEFAULT_PHASES
  }));

  const subtaskCount = subtasks.length;
  const totalSubtaskDuration = subtaskTimings.reduce(
    (sum, s) => sum + s.durationMs,
    0
  );
  const averageDurationMs =
    subtaskCount > 0 ? Math.round(totalSubtaskDuration / subtaskCount) : 0;

  const aggregatePhases = aggregatePhaseDurations(subtaskTimings);

  return {
    taskTitle: task.frontmatter.title,
    totalDurationMs: task.frontmatter.durationMs ?? 0,
    subtaskCount,
    averageDurationMs,
    subtaskTimings,
    bottleneck: detectBottleneck(aggregatePhases)
  };
};

const aggregatePhaseDurations = (
  subtaskTimings: Array<{ phases: PhaseTimings }>
): PhaseTimings => {
  const totals: Record<keyof PhaseTimings, number> = {
    implementation: 0,
    review: 0,
    merge: 0,
    conflictSolver: 0
  };

  for (const { phases } of subtaskTimings) {
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
