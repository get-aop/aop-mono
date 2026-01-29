import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { Subtask, SubtaskStatus } from "../types";

export interface StatusStyle {
  borderColor: string;
  fillColor: string;
}

const STATUS_STYLES: Record<SubtaskStatus, StatusStyle> = {
  PENDING: { borderColor: "#9ca3af", fillColor: "#ffffff" },
  INPROGRESS: { borderColor: "#3b82f6", fillColor: "#dbeafe" },
  AGENT_REVIEW: { borderColor: "#eab308", fillColor: "#fef9c3" },
  PENDING_MERGE: { borderColor: "#eab308", fillColor: "#fef9c3" },
  MERGE_CONFLICT: { borderColor: "#ef4444", fillColor: "#fee2e2" },
  BLOCKED: { borderColor: "#ef4444", fillColor: "#fee2e2" },
  DONE: { borderColor: "#22c55e", fillColor: "#dcfce7" }
};

export const getStatusStyle = (status: SubtaskStatus): StatusStyle =>
  STATUS_STYLES[status];

export interface SubtaskNodeData {
  subtask: Subtask;
  hasActiveAgent: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onUnblock: () => void;
}

const NODE_WIDTH = 160;

interface UnblockButtonProps {
  onUnblock: () => void;
}

const UnblockButton = ({ onUnblock }: UnblockButtonProps) => (
  <button
    type="button"
    className="dag-node-unblock"
    onClick={(e) => {
      e.stopPropagation();
      onUnblock();
    }}
    style={{
      background: "#22c55e",
      color: "#ffffff",
      border: "none",
      borderRadius: "3px",
      padding: "2px 8px",
      fontSize: "10px",
      fontWeight: 600,
      cursor: "pointer",
      marginTop: "4px"
    }}
  >
    Unblock
  </button>
);

export const SubtaskNode = ({ data }: NodeProps<SubtaskNodeData>) => {
  const { subtask, hasActiveAgent, isSelected, onSelect, onUnblock } = data;
  const style = getStatusStyle(subtask.frontmatter.status);
  const showUnblock = subtask.frontmatter.status === "BLOCKED";

  const borderColor = isSelected ? "#3b82f6" : style.borderColor;
  const borderWidth = isSelected ? 3 : 2;

  return (
    // biome-ignore lint/a11y/useSemanticElements: React Flow node wrapper requires div for proper drag/selection behavior
    <div
      className={hasActiveAgent ? "dag-node-pulse" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      role="button"
      tabIndex={0}
      style={{
        background: style.fillColor,
        borderColor: borderColor,
        borderWidth: `${borderWidth}px`,
        borderStyle: "solid",
        borderRadius: "6px",
        padding: "8px 12px",
        cursor: "pointer",
        minWidth: `${NODE_WIDTH}px`,
        textAlign: "center"
      }}
    >
      <Handle type="target" position={Position.Left} style={{ left: "-8px" }} />
      <div style={{ color: "#6b7280", fontSize: "12px" }}>
        #{subtask.number}
      </div>
      <div
        style={{
          fontSize: "14px",
          fontWeight: 500,
          color: "#1f2937",
          textOverflow: "ellipsis",
          overflow: "hidden",
          whiteSpace: "nowrap",
          maxWidth: `${NODE_WIDTH - 24}px`
        }}
      >
        {subtask.frontmatter.title}
      </div>
      {showUnblock && <UnblockButton onUnblock={onUnblock} />}
      <Handle
        type="source"
        position={Position.Right}
        style={{ right: "-8px" }}
      />
    </div>
  );
};
