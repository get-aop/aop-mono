import { formatDuration } from "./core/timing";

export const formatJobCompletedMessage = (
  jobType: string,
  durationMs: number
): string => {
  return `✓ ${jobType} completed (${formatDuration(durationMs)})`;
};

export const formatSubtaskStartMessage = (
  number: number,
  total: number,
  title: string
): string => {
  return `▶ Starting subtask ${number}/${total}: ${title}`;
};

export const formatSubtaskCompletedMessage = (
  number: number,
  total: number,
  title: string,
  durationMs: number
): string => {
  return `✓ Subtask ${number}/${total}: ${title} completed (${formatDuration(durationMs)})`;
};
