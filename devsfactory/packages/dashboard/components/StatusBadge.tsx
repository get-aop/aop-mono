import type { TaskStatus } from "../types";

interface StatusBadgeProps {
  status: TaskStatus;
  active?: boolean;
}

export const StatusBadge = ({ status, active }: StatusBadgeProps) => {
  const statusClass = `status-${status.toLowerCase()}`;
  const pulsingClass = active ? "pulsing" : "";

  return (
    <span className={`status-badge ${statusClass} ${pulsingClass}`.trim()}>
      {status}
    </span>
  );
};
