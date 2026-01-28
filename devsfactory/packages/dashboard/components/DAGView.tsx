import { useDashboardStore } from "../context";
import {
  calculateDAGLayout,
  type DAGNode as DAGNodeData
} from "../lib/dag-layout";
import type { Subtask } from "../types";
import { DAGEdge } from "./DAGEdge";
import { DAGNode } from "./DAGNode";

export interface DAGViewProps {
  subtasks: Subtask[];
  taskFolder: string;
}

export const DAGView = ({ subtasks, taskFolder }: DAGViewProps) => {
  const activeAgents = useDashboardStore((s) => s.activeAgents);
  const selectedSubtask = useDashboardStore((s) => s.selectedSubtask);
  const selectSubtask = useDashboardStore((s) => s.selectSubtask);
  const setSubtaskStatus = useDashboardStore((s) => s.setSubtaskStatus);

  const nodes = calculateDAGLayout(subtasks);
  const nodeMap = new Map(nodes.map((n) => [n.subtask.number, n]));

  const edges = buildEdges(subtasks, nodeMap);
  const viewBox = calculateViewBox(nodes);

  const hasActiveAgent = (subtask: Subtask) =>
    Array.from(activeAgents.values()).some(
      (agent) =>
        agent.taskFolder === taskFolder &&
        agent.subtaskFile === subtask.filename
    );

  const isSelected = (subtask: Subtask) =>
    selectedSubtask?.taskFolder === taskFolder &&
    selectedSubtask?.subtaskFile === subtask.filename;

  return (
    <div className="dag-view">
      <svg
        viewBox={viewBox}
        style={{ width: "100%", height: "100%" }}
        role="img"
        aria-label="Subtask dependency graph"
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#9ca3af" />
          </marker>
        </defs>
        {edges.map((edge) => (
          <DAGEdge
            key={`${edge.sourceX}-${edge.sourceY}-${edge.targetX}-${edge.targetY}`}
            {...edge}
          />
        ))}
        {nodes.map((node) => (
          <DAGNode
            key={node.subtask.number}
            subtask={node.subtask}
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            hasActiveAgent={hasActiveAgent(node.subtask)}
            isSelected={isSelected(node.subtask)}
            onClick={() => selectSubtask(taskFolder, node.subtask.filename)}
            onUnblock={() =>
              setSubtaskStatus(taskFolder, node.subtask.filename, "PENDING")
            }
          />
        ))}
      </svg>
    </div>
  );
};

interface EdgeProps {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

const buildEdges = (
  subtasks: Subtask[],
  nodeMap: Map<number, DAGNodeData>
): EdgeProps[] => {
  const edges: EdgeProps[] = [];

  for (const subtask of subtasks) {
    const targetNode = nodeMap.get(subtask.number);
    if (!targetNode) continue;

    for (const depNum of subtask.frontmatter.dependencies) {
      const sourceNode = nodeMap.get(depNum);
      if (!sourceNode) continue;

      edges.push({
        sourceX: sourceNode.x + sourceNode.width,
        sourceY: sourceNode.y + sourceNode.height / 2,
        targetX: targetNode.x,
        targetY: targetNode.y + targetNode.height / 2
      });
    }
  }

  return edges;
};

const calculateViewBox = (nodes: DAGNodeData[]): string => {
  if (nodes.length === 0) return "0 0 200 100";

  const padding = 20;
  let maxX = 0;
  let maxY = 0;

  for (const node of nodes) {
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return `-${padding} -${padding} ${maxX + padding * 2} ${maxY + padding * 2}`;
};
