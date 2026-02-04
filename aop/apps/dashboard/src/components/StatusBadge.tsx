import type { TaskStatus } from "@aop/common";

interface StatusBadgeProps {
  status: TaskStatus;
  showLabel?: boolean;
}

const statusConfig: Record<TaskStatus, { color: string; label: string }> = {
  DRAFT: { color: "bg-aop-charcoal", label: "DRAFT" },
  READY: { color: "bg-aop-amber", label: "READY" },
  WORKING: { color: "bg-aop-working", label: "WORKING" },
  DONE: { color: "bg-aop-success", label: "DONE" },
  BLOCKED: { color: "bg-aop-blocked", label: "BLOCKED" },
  REMOVED: { color: "bg-aop-slate-dark", label: "REMOVED" },
};

export const StatusBadge = ({ status, showLabel = true }: StatusBadgeProps) => {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-1.5" data-testid="status-badge">
      <div className={`h-2 w-2 rounded-full ${config.color}`} />
      {showLabel && (
        <span className="font-mono text-[11px] text-aop-slate-light">{config.label}</span>
      )}
    </div>
  );
};
