import { describe, expect, test } from "bun:test";
import { MarkerType } from "@xyflow/react";
import type { Subtask } from "../types";
import type { DAGNode } from "./dag-layout";
import { toReactFlowEdges, toReactFlowNodes } from "./react-flow-adapter";

const createSubtask = (
  number: number,
  title: string,
  dependencies: number[] = []
): Subtask => ({
  filename: `00${number}-${title.toLowerCase().replace(/\s+/g, "-")}.md`,
  number,
  slug: title.toLowerCase().replace(/\s+/g, "-"),
  frontmatter: {
    title,
    status: "PENDING",
    dependencies
  },
  description: `Description for ${title}`
});

const createDAGNode = (
  subtask: Subtask,
  x: number,
  y: number,
  width = 160,
  height = 60
): DAGNode => ({
  subtask,
  x,
  y,
  width,
  height
});

describe("toReactFlowNodes", () => {
  test("returns empty array for empty input", () => {
    const result = toReactFlowNodes([]);
    expect(result).toEqual([]);
  });

  test("converts single DAGNode to React Flow node", () => {
    const subtask = createSubtask(1, "First Task");
    const dagNode = createDAGNode(subtask, 0, 0);

    const result = toReactFlowNodes([dagNode]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "001-first-task.md",
      type: "subtask",
      position: { x: 0, y: 0 },
      data: {
        subtask
      }
    });
  });

  test("converts multiple DAGNodes with correct positions", () => {
    const subtask1 = createSubtask(1, "First");
    const subtask2 = createSubtask(2, "Second", [1]);
    const dagNodes = [
      createDAGNode(subtask1, 0, 0),
      createDAGNode(subtask2, 240, 0)
    ];

    const result = toReactFlowNodes(dagNodes);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("001-first.md");
    expect(result[0].position).toEqual({ x: 0, y: 0 });
    expect(result[1].id).toBe("002-second.md");
    expect(result[1].position).toEqual({ x: 240, y: 0 });
  });

  test("uses subtask filename as node id", () => {
    const subtask = createSubtask(5, "Custom Task Name");
    const dagNode = createDAGNode(subtask, 100, 200);

    const result = toReactFlowNodes([dagNode]);

    expect(result[0].id).toBe("005-custom-task-name.md");
  });

  test("all nodes have type 'subtask'", () => {
    const subtasks = [
      createSubtask(1, "One"),
      createSubtask(2, "Two"),
      createSubtask(3, "Three")
    ];
    const dagNodes = subtasks.map((s, i) => createDAGNode(s, i * 100, 0));

    const result = toReactFlowNodes(dagNodes);

    for (const node of result) {
      expect(node.type).toBe("subtask");
    }
  });

  test("data contains subtask reference", () => {
    const subtask = createSubtask(1, "Test", []);
    const dagNode = createDAGNode(subtask, 0, 0);

    const result = toReactFlowNodes([dagNode]);

    expect(result[0].data.subtask).toBe(subtask);
  });
});

describe("toReactFlowEdges", () => {
  test("returns empty array for empty input", () => {
    const result = toReactFlowEdges([]);
    expect(result).toEqual([]);
  });

  test("returns empty array for subtasks without dependencies", () => {
    const subtasks = [
      createSubtask(1, "First"),
      createSubtask(2, "Second"),
      createSubtask(3, "Third")
    ];

    const result = toReactFlowEdges(subtasks);

    expect(result).toEqual([]);
  });

  test("creates edge for single dependency", () => {
    const subtasks = [
      createSubtask(1, "First"),
      createSubtask(2, "Second", [1])
    ];

    const result = toReactFlowEdges(subtasks);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "edge-001-first.md-002-second.md",
      source: "001-first.md",
      target: "002-second.md",
      type: "default",
      markerEnd: { type: MarkerType.ArrowClosed }
    });
  });

  test("creates multiple edges for multiple dependencies", () => {
    const subtasks = [
      createSubtask(1, "First"),
      createSubtask(2, "Second"),
      createSubtask(3, "Third", [1, 2])
    ];

    const result = toReactFlowEdges(subtasks);

    expect(result).toHaveLength(2);

    const edge1 = result.find((e) => e.source === "001-first.md");
    const edge2 = result.find((e) => e.source === "002-second.md");

    expect(edge1).toBeDefined();
    expect(edge1?.target).toBe("003-third.md");

    expect(edge2).toBeDefined();
    expect(edge2?.target).toBe("003-third.md");
  });

  test("handles complex dependency graph", () => {
    const subtasks = [
      createSubtask(1, "Root"),
      createSubtask(2, "Child A", [1]),
      createSubtask(3, "Child B", [1]),
      createSubtask(4, "Grandchild", [2, 3])
    ];

    const result = toReactFlowEdges(subtasks);

    expect(result).toHaveLength(4);
    const sources = result.map((e) => e.source);
    const targets = result.map((e) => e.target);

    expect(sources.filter((s) => s === "001-root.md")).toHaveLength(2);
    expect(targets.filter((t) => t === "004-grandchild.md")).toHaveLength(2);
  });

  test("all edges have type default", () => {
    const subtasks = [
      createSubtask(1, "First"),
      createSubtask(2, "Second", [1])
    ];

    const result = toReactFlowEdges(subtasks);

    for (const edge of result) {
      expect(edge.type).toBe("default");
    }
  });

  test("all edges have arrow marker at end", () => {
    const subtasks = [
      createSubtask(1, "First"),
      createSubtask(2, "Second", [1])
    ];

    const result = toReactFlowEdges(subtasks);

    for (const edge of result) {
      expect(edge.markerEnd).toEqual({ type: MarkerType.ArrowClosed });
    }
  });

  test("edge id format is edge-{source}-{target}", () => {
    const subtasks = [
      createSubtask(1, "First"),
      createSubtask(2, "Second", [1])
    ];

    const result = toReactFlowEdges(subtasks);

    expect(result[0].id).toBe("edge-001-first.md-002-second.md");
  });
});
