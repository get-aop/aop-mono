import type { TaskSummary } from "./timing";
import { formatDuration } from "./timing";

const TITLE_MAX_WIDTH = 28;
const IMPL_WIDTH = 8;
const REVIEW_WIDTH = 8;
const TOTAL_WIDTH = 10;
const TABLE_WIDTH = TITLE_MAX_WIDTH + IMPL_WIDTH + REVIEW_WIDTH + TOTAL_WIDTH + 7;
const EMPTY_IMPL = " ".repeat(IMPL_WIDTH);
const EMPTY_REVIEW = " ".repeat(REVIEW_WIDTH);

const truncate = (text: string, maxWidth: number): string => {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + "…";
};

const padRight = (text: string, width: number): string =>
  text + " ".repeat(Math.max(0, width - text.length));

const padLeft = (text: string, width: number): string =>
  " ".repeat(Math.max(0, width - text.length)) + text;

const formatPhase = (ms: number | null): string => {
  if (ms === null || ms === 0) return "-";
  return formatDuration(ms);
};

const renderHorizontalLine = (
  left: string,
  right: string,
  colSeparator: string
): string => {
  const titleDash = "─".repeat(TITLE_MAX_WIDTH + 2);
  const implDash = "─".repeat(IMPL_WIDTH);
  const reviewDash = "─".repeat(REVIEW_WIDTH);
  const totalDash = "─".repeat(TOTAL_WIDTH + 2);
  return `${left}${titleDash}${colSeparator}${implDash}${colSeparator}${reviewDash}${colSeparator}${totalDash}${right}`;
};

const renderHeaderLine = (left: string, right: string): string =>
  `${left}${"─".repeat(TABLE_WIDTH - 2)}${right}`;

const renderFullWidthRow = (text: string): string =>
  `│ ${padRight(text, TABLE_WIDTH - 4)} │`;

const renderDataRow = (
  title: string,
  impl: string,
  review: string,
  total: string
): string =>
  `│ ${padRight(title, TITLE_MAX_WIDTH)} │${padLeft(impl, IMPL_WIDTH)}│${padLeft(review, REVIEW_WIDTH)}│ ${padLeft(total, TOTAL_WIDTH)} │`;

const renderSummaryRow = (label: string, total: string): string =>
  `│ ${padRight(label, TITLE_MAX_WIDTH)} │${EMPTY_IMPL}│${EMPTY_REVIEW}│ ${padLeft(total, TOTAL_WIDTH)} │`;

const renderSubtaskRow = (
  subtask: TaskSummary["subtaskTimings"][0],
  index: number
): string => {
  const numberedTitle = truncate(`${index + 1}. ${subtask.title}`, TITLE_MAX_WIDTH);
  return renderDataRow(
    numberedTitle,
    formatPhase(subtask.phases.implementation),
    formatPhase(subtask.phases.review),
    formatDuration(subtask.durationMs)
  );
};

export const renderSummaryTable = (summary: TaskSummary): string => {
  const lines: string[] = [];

  lines.push(renderHeaderLine("┌", "┐"));
  lines.push(renderFullWidthRow(`Task completed: ${summary.taskTitle}`));
  lines.push(renderHorizontalLine("├", "┤", "┬"));

  lines.push(renderDataRow("Subtask", "Impl", "Review", "Total"));
  lines.push(renderHorizontalLine("├", "┤", "┼"));

  for (let i = 0; i < summary.subtaskTimings.length; i++) {
    lines.push(renderSubtaskRow(summary.subtaskTimings[i]!, i));
  }

  lines.push(renderHorizontalLine("├", "┤", "┼"));

  lines.push(renderSummaryRow(
    `Total: ${summary.subtaskCount} subtasks`,
    formatDuration(summary.totalDurationMs)
  ));
  lines.push(renderSummaryRow(
    "Average per subtask",
    formatDuration(summary.averageDurationMs)
  ));

  if (summary.bottleneck) {
    lines.push(renderFullWidthRow(
      `⚠ Slowest phase: ${summary.bottleneck.phase} (${summary.bottleneck.percent}% of time)`
    ));
  }

  lines.push(renderHeaderLine("└", "┘"));

  return lines.join("\n");
};
