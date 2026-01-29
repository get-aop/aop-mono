import { type Edge, MarkerType, type Node } from "@xyflow/react";
import type { SubtaskNodeData } from "../components/SubtaskNode";
import type { Subtask } from "../types";
import type { DAGNode } from "./dag-layout";

export type SubtaskFlowNode = Node<SubtaskNodeData, "subtask">;

export const toReactFlowNodes = (dagNodes: DAGNode[]): SubtaskFlowNode[] =>
  dagNodes.map((dagNode) => ({
    id: dagNode.subtask.filename,
    type: "subtask" as const,
    position: { x: dagNode.x, y: dagNode.y },
    data: {
      subtask: dagNode.subtask
    }
  }));

export const toReactFlowEdges = (subtasks: Subtask[]): Edge[] => {
  const filenameByNumber = new Map(subtasks.map((s) => [s.number, s.filename]));

  return subtasks.flatMap((subtask) =>
    subtask.frontmatter.dependencies.map((depNumber) => {
      const sourceFilename = filenameByNumber.get(depNumber)!;
      return {
        id: `edge-${sourceFilename}-${subtask.filename}`,
        source: sourceFilename,
        target: subtask.filename,
        type: "default" as const,
        markerEnd: { type: MarkerType.ArrowClosed }
      };
    })
  );
};
