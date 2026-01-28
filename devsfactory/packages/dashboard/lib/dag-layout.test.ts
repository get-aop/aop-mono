import { describe, expect, test } from "bun:test";
import type { Subtask } from "../types";
import { calculateDAGLayout } from "./dag-layout";

const makeSubtask = (number: number, dependencies: number[] = []): Subtask => ({
  filename: `00${number}-test.md`,
  number,
  slug: "test",
  frontmatter: {
    title: `Subtask ${number}`,
    status: "PENDING",
    dependencies
  },
  description: ""
});

describe("calculateDAGLayout", () => {
  test("returns empty array for empty input", () => {
    const result = calculateDAGLayout([]);
    expect(result).toEqual([]);
  });

  test("positions single node at origin", () => {
    const subtasks = [makeSubtask(1)];
    const result = calculateDAGLayout(subtasks);

    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(0);
    expect(result[0].y).toBe(0);
    expect(result[0].subtask.number).toBe(1);
  });

  test("places independent nodes in same column, stacked vertically", () => {
    const subtasks = [makeSubtask(1), makeSubtask(2), makeSubtask(3)];
    const result = calculateDAGLayout(subtasks);

    expect(result).toHaveLength(3);
    expect(result.every((n) => n.x === 0)).toBe(true);
    expect(result[0].y).toBe(0);
    expect(result[1].y).toBe(100);
    expect(result[2].y).toBe(200);
  });

  test("places dependent node in next column", () => {
    const subtasks = [makeSubtask(1), makeSubtask(2, [1])];
    const result = calculateDAGLayout(subtasks);

    const node1 = result.find((n) => n.subtask.number === 1)!;
    const node2 = result.find((n) => n.subtask.number === 2)!;

    expect(node1.x).toBe(0);
    expect(node2.x).toBe(240);
  });

  test("assigns column based on longest path from root", () => {
    const subtasks = [
      makeSubtask(1),
      makeSubtask(2, [1]),
      makeSubtask(3, [2]),
      makeSubtask(4, [1])
    ];
    const result = calculateDAGLayout(subtasks);

    const node1 = result.find((n) => n.subtask.number === 1)!;
    const node2 = result.find((n) => n.subtask.number === 2)!;
    const node3 = result.find((n) => n.subtask.number === 3)!;
    const node4 = result.find((n) => n.subtask.number === 4)!;

    expect(node1.x).toBe(0);
    expect(node2.x).toBe(240);
    expect(node3.x).toBe(480);
    expect(node4.x).toBe(240);
  });

  test("stacks nodes within same column vertically", () => {
    const subtasks = [makeSubtask(1), makeSubtask(2, [1]), makeSubtask(3, [1])];
    const result = calculateDAGLayout(subtasks);

    const node2 = result.find((n) => n.subtask.number === 2)!;
    const node3 = result.find((n) => n.subtask.number === 3)!;

    expect(node2.x).toBe(node3.x);
    expect(node2.y).not.toBe(node3.y);
  });

  test("uses specified dimensions for spacing", () => {
    const subtasks = [makeSubtask(1), makeSubtask(2)];
    const result = calculateDAGLayout(subtasks, {
      nodeWidth: 200,
      nodeHeight: 80,
      horizontalGap: 100,
      verticalGap: 50
    });

    expect(result[1].y).toBe(130);
  });

  test("returns node dimensions in result", () => {
    const subtasks = [makeSubtask(1)];
    const result = calculateDAGLayout(subtasks);

    expect(result[0].width).toBe(160);
    expect(result[0].height).toBe(60);
  });

  test("handles diamond dependency pattern", () => {
    const subtasks = [
      makeSubtask(1),
      makeSubtask(2, [1]),
      makeSubtask(3, [1]),
      makeSubtask(4, [2, 3])
    ];
    const result = calculateDAGLayout(subtasks);

    const node1 = result.find((n) => n.subtask.number === 1)!;
    const node2 = result.find((n) => n.subtask.number === 2)!;
    const node3 = result.find((n) => n.subtask.number === 3)!;
    const node4 = result.find((n) => n.subtask.number === 4)!;

    expect(node1.x).toBe(0);
    expect(node2.x).toBe(240);
    expect(node3.x).toBe(240);
    expect(node4.x).toBe(480);
  });
});
