import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  ReactFlow,
  ReactFlowProvider
} from "@xyflow/react";
import { useDashboardStore } from "../context";
import { calculateDAGLayout } from "../lib/dag-layout";
import type { Subtask } from "../types";
import {
  getStatusStyle,
  SubtaskNode,
  type SubtaskNodeData
} from "./SubtaskNode";

import "@xyflow/react/dist/style.css";

export interface DAGViewProps {
  subtasks: Subtask[];
  taskFolder: string;
}

const nodeTypes = { subtask: SubtaskNode };

const nodeColor = (node: Node<SubtaskNodeData>) =>
  getStatusStyle(node.data.subtask.frontmatter.status).borderColor;

export const DAGView = ({ subtasks, taskFolder }: DAGViewProps) => {
  const activeAgents = useDashboardStore((s) => s.activeAgents);
  const selectedSubtask = useDashboardStore((s) => s.selectedSubtask);
  const selectSubtask = useDashboardStore((s) => s.selectSubtask);
  const setSubtaskStatus = useDashboardStore((s) => s.setSubtaskStatus);

  const dagNodes = calculateDAGLayout(subtasks);
  const subtaskByNumber = new Map(subtasks.map((s) => [s.number, s]));

  const hasActiveAgent = (subtask: Subtask) =>
    Array.from(activeAgents.values()).some(
      (agent) =>
        agent.taskFolder === taskFolder &&
        agent.subtaskFile === subtask.filename
    );

  const isSelected = (subtask: Subtask) =>
    selectedSubtask?.taskFolder === taskFolder &&
    selectedSubtask?.subtaskFile === subtask.filename;

  const nodes: Node<SubtaskNodeData>[] = dagNodes.map((node) => ({
    id: node.subtask.filename,
    type: "subtask",
    position: { x: node.x, y: node.y },
    data: {
      subtask: node.subtask,
      hasActiveAgent: hasActiveAgent(node.subtask),
      isSelected: isSelected(node.subtask),
      onSelect: () => selectSubtask(taskFolder, node.subtask.filename),
      onUnblock: () =>
        setSubtaskStatus(taskFolder, node.subtask.filename, "PENDING")
    }
  }));

  const edges: Edge[] = subtasks.flatMap((subtask) =>
    subtask.frontmatter.dependencies
      .map((depNum) => {
        const depSubtask = subtaskByNumber.get(depNum);
        if (!depSubtask) return null;
        return {
          id: `${depSubtask.filename}-${subtask.filename}`,
          source: depSubtask.filename,
          target: subtask.filename,
          type: "default",
          style: { stroke: "#9ca3af", strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#9ca3af" }
        };
      })
      .filter((edge): edge is Edge => edge !== null)
  );

  return (
    <div className="dag-view" style={{ width: "100%", height: "100%" }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={true}
          nodesConnectable={false}
          edgesUpdatable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Controls />
          <MiniMap nodeColor={nodeColor} position="bottom-right" />
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
};
