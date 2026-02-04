import type { Step, StepStatus } from "../types";

interface StepListProps {
  steps: Step[];
}

const formatDuration = (startedAt: string, endedAt?: string): string => {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;

  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const formatStepType = (stepType: string | null): string => {
  if (!stepType) return "unknown";
  return stepType.replace(/-/g, " ").replace(/_/g, " ");
};

const statusConfig: Record<StepStatus, { color: string; bgColor: string; label: string }> = {
  running: { color: "text-aop-working", bgColor: "bg-aop-working/20", label: "running" },
  success: { color: "text-aop-success", bgColor: "bg-aop-success/20", label: "success" },
  failure: { color: "text-aop-blocked", bgColor: "bg-aop-blocked/20", label: "failed" },
  cancelled: { color: "text-aop-slate", bgColor: "bg-aop-slate/20", label: "cancelled" },
};

export const StepList = ({ steps }: StepListProps) => {
  if (steps.length === 0) {
    return (
      <div className="py-2 px-3 font-mono text-[10px] text-aop-slate-dark">No steps recorded</div>
    );
  }

  return (
    <div className="flex flex-col gap-1 py-2 px-3" data-testid="step-list">
      {steps.map((step, index) => {
        const config = statusConfig[step.status];
        const isLast = index === steps.length - 1;

        return (
          <div
            key={step.id}
            className="flex items-center gap-2"
            data-testid={`step-item-${step.id}`}
          >
            <div className="flex items-center gap-1.5">
              <div
                className={`h-1.5 w-1.5 rounded-full ${step.status === "running" ? "bg-aop-working animate-pulse" : config.color.replace("text-", "bg-")}`}
              />
              {!isLast && (
                <div className="absolute left-[7px] top-[14px] h-4 w-px bg-aop-charcoal" />
              )}
            </div>

            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] capitalize ${config.bgColor} ${config.color}`}
              data-testid="step-type-badge"
            >
              {formatStepType(step.stepType)}
            </span>

            <span className={`font-mono text-[10px] ${config.color}`}>{config.label}</span>

            <span className="font-mono text-[10px] text-aop-slate-dark">
              {step.status === "running"
                ? "running..."
                : formatDuration(step.startedAt, step.endedAt)}
            </span>

            {step.error && (
              <span className="truncate font-mono text-[10px] text-aop-blocked" title={step.error}>
                {step.error}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
