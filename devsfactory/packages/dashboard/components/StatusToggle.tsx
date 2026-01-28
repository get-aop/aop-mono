import type { TaskStatus } from "../types";

interface StatusTransition {
  label: string;
  targetStatus: TaskStatus;
}

export const getAvailableTransitions = (
  status: TaskStatus
): StatusTransition[] => {
  switch (status) {
    case "BACKLOG":
      return [{ label: "Start", targetStatus: "PENDING" }];
    case "PENDING":
      return [{ label: "Defer", targetStatus: "BACKLOG" }];
    case "BLOCKED":
      return [{ label: "Unblock", targetStatus: "PENDING" }];
    default:
      return [];
  }
};

interface StatusToggleProps {
  status: TaskStatus;
  onTransition: (targetStatus: TaskStatus) => void;
  disabled?: boolean;
}

export const StatusToggle = ({
  status,
  onTransition,
  disabled
}: StatusToggleProps) => {
  const transitions = getAvailableTransitions(status);

  if (transitions.length === 0) {
    return null;
  }

  const transition = transitions[0];
  const statusClass = `status-toggle-${status.toLowerCase()}`;

  return (
    <button
      type="button"
      className={`status-toggle ${statusClass}`}
      onClick={(e) => {
        e.stopPropagation();
        onTransition(transition.targetStatus);
      }}
      disabled={disabled}
    >
      {transition.label}
    </button>
  );
};
