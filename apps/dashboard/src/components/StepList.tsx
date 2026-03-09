import type { Step, StepStatus } from "../types";
import type { LogLine } from "./LogViewer";

interface StepListProps {
  steps: Step[];
  selectedStepId?: string | null;
  onStepClick?: (stepId: string) => void;
}

export const filterLogsByStep = (logLines: LogLine[], step: Step): LogLine[] => {
  const startMs = new Date(step.startedAt).getTime();
  const endMs = step.endedAt ? new Date(step.endedAt).getTime() : undefined;

  return logLines.filter((log) => {
    const logMs = new Date(log.timestamp).getTime();
    if (logMs < startMs) return false;
    if (endMs !== undefined && logMs > endMs) return false;
    return true;
  });
};

export const StepList = ({ steps, selectedStepId, onStepClick }: StepListProps) => {
  if (steps.length === 0) {
    return (
      <div className="py-2 px-3 font-mono text-[10px] text-aop-slate-dark">No steps recorded</div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-0.5 overflow-hidden py-1 px-3" data-testid="step-list">
      {steps.map((step, index) => (
        <StepRow
          key={step.id}
          step={step}
          isLast={index === steps.length - 1}
          isSelected={selectedStepId === step.id}
          onStepClick={onStepClick}
        />
      ))}
    </div>
  );
};

interface StepRowProps {
  step: Step;
  isLast: boolean;
  isSelected: boolean;
  onStepClick?: (stepId: string) => void;
}

const StepRow = ({ step, isLast, isSelected, onStepClick }: StepRowProps) => {
  const config = statusConfig[step.status];
  const content = (
    <StepRowContent
      step={step}
      config={config}
      isLast={isLast}
      isSelected={isSelected}
      isClickable={!!onStepClick}
    />
  );

  return (
    <div data-testid={`step-item-${step.id}`}>
      {onStepClick ? (
        <button
          type="button"
          className={`flex w-full shrink-0 items-center gap-2 cursor-pointer rounded px-1 -mx-1 hover:bg-aop-charcoal/50 ${isSelected ? "bg-aop-charcoal/30" : ""}`}
          onClick={() => onStepClick(step.id)}
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-2">{content}</div>
      )}
    </div>
  );
};

interface StepRowContentProps {
  step: Step;
  config: { color: string; bgColor: string; label: string };
  isLast: boolean;
  isSelected: boolean;
  isClickable: boolean;
}

const StepRowContent = ({ step, config, isLast, isSelected, isClickable }: StepRowContentProps) => (
  <>
    <div className="flex items-center gap-1.5">
      <div
        className={`h-1.5 w-1.5 rounded-full ${step.status === "running" ? "bg-aop-working animate-pulse" : config.color.replace("text-", "bg-")}`}
      />
      {!isLast && <div className="absolute left-[7px] top-[14px] h-4 w-px bg-aop-charcoal" />}
    </div>

    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${config.bgColor} ${config.color}`}
      data-testid="step-type-badge"
    >
      {formatStepLabel(step)}
    </span>

    <span className={`font-mono text-[10px] ${config.color}`}>{config.label}</span>

    <span className="font-mono text-[10px] text-aop-slate-dark">
      {step.status === "running" ? "running..." : formatDuration(step.startedAt, step.endedAt)}
    </span>

    {step.error && (
      <span className="truncate font-mono text-[10px] text-aop-blocked" title={step.error}>
        {step.error}
      </span>
    )}

    {isClickable && (
      <span className="ml-auto font-mono text-[10px] text-aop-slate-dark">
        {isSelected ? "▼" : "▶"}
      </span>
    )}
  </>
);

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

const formatStepLabel = (step: Step): string => {
  const raw = step.stepId || step.stepType;
  if (!raw) return "unknown";
  return raw.replace(/-/g, " ").replace(/_/g, " ");
};

const statusConfig: Record<StepStatus, { color: string; bgColor: string; label: string }> = {
  running: { color: "text-aop-working", bgColor: "bg-aop-working/20", label: "running" },
  success: { color: "text-aop-success", bgColor: "bg-aop-success/20", label: "success" },
  failure: { color: "text-aop-blocked", bgColor: "bg-aop-blocked/20", label: "failed" },
  cancelled: { color: "text-aop-slate", bgColor: "bg-aop-slate/20", label: "cancelled" },
};
