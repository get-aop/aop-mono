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

interface UnblockButtonProps {
  width: number;
  height: number;
  onUnblock: () => void;
}

const UnblockButton = ({ width, height, onUnblock }: UnblockButtonProps) => (
  // biome-ignore lint/a11y/useSemanticElements: SVG group elements cannot be replaced with semantic HTML
  <g
    className="dag-node-unblock"
    style={{ cursor: "pointer" }}
    onClick={(e) => {
      e.stopPropagation();
      onUnblock();
    }}
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        e.stopPropagation();
        onUnblock();
      }
    }}
    role="button"
    tabIndex={0}
  >
    <rect
      x={width / 2 - 30}
      y={height - 20}
      width={60}
      height={16}
      rx={3}
      fill="#22c55e"
    />
    <text
      x={width / 2}
      y={height - 8}
      textAnchor="middle"
      fontSize={10}
      fontWeight={600}
      fill="#ffffff"
    >
      Unblock
    </text>
  </g>
);

export interface DAGNodeProps {
  subtask: Subtask;
  x: number;
  y: number;
  width: number;
  height: number;
  hasActiveAgent?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onUnblock?: () => void;
}

export const DAGNode = ({
  subtask,
  x,
  y,
  width,
  height,
  hasActiveAgent,
  isSelected,
  onClick,
  onUnblock
}: DAGNodeProps) => {
  const style = getStatusStyle(subtask.frontmatter.status);
  const className = hasActiveAgent ? "dag-node-pulse" : undefined;
  const showUnblock = onUnblock && subtask.frontmatter.status === "BLOCKED";
  const titleY = showUnblock ? 35 : 40;

  const strokeWidth = isSelected ? 3 : 2;
  const strokeColor = isSelected ? "#3b82f6" : style.borderColor;

  const nodeContent = (
    <>
      <rect
        width={width}
        height={height}
        rx={6}
        fill={style.fillColor}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
      <text
        x={width / 2}
        y={20}
        textAnchor="middle"
        fontSize={12}
        fill="#6b7280"
      >
        #{subtask.number}
      </text>
      <text
        x={width / 2}
        y={titleY}
        textAnchor="middle"
        fontSize={14}
        fontWeight={500}
        fill="#1f2937"
      >
        {subtask.frontmatter.title}
      </text>
      {showUnblock && (
        <UnblockButton width={width} height={height} onUnblock={onUnblock} />
      )}
    </>
  );

  if (!onClick) {
    return (
      <g transform={`translate(${x}, ${y})`} className={className}>
        {nodeContent}
      </g>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG group elements cannot be replaced with semantic HTML
    <g
      transform={`translate(${x}, ${y})`}
      className={className}
      style={{ cursor: "pointer" }}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      role="button"
      tabIndex={0}
    >
      {nodeContent}
    </g>
  );
};
