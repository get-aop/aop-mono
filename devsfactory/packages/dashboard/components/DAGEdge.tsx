export interface Point {
  x: number;
  y: number;
}

export const generateBezierPath = (source: Point, target: Point): string => {
  const controlX = (source.x + target.x) / 2;
  return `M ${source.x} ${source.y} Q ${controlX} ${source.y} ${target.x} ${target.y}`;
};

export interface DAGEdgeProps {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

export const DAGEdge = ({
  sourceX,
  sourceY,
  targetX,
  targetY
}: DAGEdgeProps) => {
  const d = generateBezierPath(
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY }
  );

  return (
    <path
      d={d}
      fill="none"
      stroke="#9ca3af"
      strokeWidth={2}
      markerEnd="url(#arrowhead)"
    />
  );
};
