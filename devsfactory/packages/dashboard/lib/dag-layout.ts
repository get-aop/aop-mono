import type { Subtask } from "../types";

export interface DAGNode {
  subtask: Subtask;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
}

const DEFAULT_OPTIONS: Required<LayoutOptions> = {
  nodeWidth: 160,
  nodeHeight: 60,
  horizontalGap: 80,
  verticalGap: 40
};

export const calculateDAGLayout = (
  subtasks: Subtask[],
  options?: LayoutOptions
): DAGNode[] => {
  if (subtasks.length === 0) return [];

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const columnSpacing = opts.nodeWidth + opts.horizontalGap;
  const rowSpacing = opts.nodeHeight + opts.verticalGap;

  const columnForNode = computeColumns(subtasks);
  const columnGroups = groupByColumn(subtasks, columnForNode);

  return subtasks.map((subtask) => {
    const column = columnForNode.get(subtask.number)!;
    const nodesInColumn = columnGroups.get(column)!;
    const rowIndex = nodesInColumn.indexOf(subtask.number);

    return {
      subtask,
      x: column * columnSpacing,
      y: rowIndex * rowSpacing,
      width: opts.nodeWidth,
      height: opts.nodeHeight
    };
  });
};

const computeColumns = (subtasks: Subtask[]): Map<number, number> => {
  const columns = new Map<number, number>();
  const byNumber = new Map(subtasks.map((s) => [s.number, s]));

  const getColumn = (num: number): number => {
    if (columns.has(num)) return columns.get(num)!;

    const subtask = byNumber.get(num);
    if (!subtask || subtask.frontmatter.dependencies.length === 0) {
      columns.set(num, 0);
      return 0;
    }

    const maxDepColumn = Math.max(
      ...subtask.frontmatter.dependencies.map((dep) => getColumn(dep))
    );
    const col = maxDepColumn + 1;
    columns.set(num, col);
    return col;
  };

  for (const subtask of subtasks) {
    getColumn(subtask.number);
  }

  return columns;
};

const groupByColumn = (
  subtasks: Subtask[],
  columnForNode: Map<number, number>
): Map<number, number[]> => {
  const groups = new Map<number, number[]>();

  for (const subtask of subtasks) {
    const col = columnForNode.get(subtask.number)!;
    const group = groups.get(col) ?? [];
    group.push(subtask.number);
    groups.set(col, group);
  }

  return groups;
};
