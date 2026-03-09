import { useEffect, useMemo, useRef, useState } from "react";
import type { Step, Task } from "../types";

export interface RetryDialogProps {
  open: boolean;
  task: Task | null;
  steps: Step[];
  onSelect: (task: Task, stepId?: string) => void;
  onCancel: () => void;
}

export const RetryDialog = ({ open, task, steps, onSelect, onCancel }: RetryDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(undefined);
  const [prevOpen, setPrevOpen] = useState(false);

  const uniqueSteps = useMemo(
    () =>
      steps.reduce<Step[]>((acc, step) => {
        if (step.stepId && !acc.some((s) => s.stepId === step.stepId)) acc.push(step);
        return acc;
      }, []),
    [steps],
  );

  // Reset selection only when dialog opens (derive-during-render pattern)
  if (open && !prevOpen) {
    setSelectedStepId(uniqueSteps[0]?.stepId ?? undefined);
  }
  if (open !== prevOpen) {
    setPrevOpen(open);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onCancel]);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto rounded-aop-lg border border-aop-charcoal bg-aop-darkest p-0 backdrop:bg-black/60"
    >
      <div className="w-80 p-6">
        <h2 className="font-body text-base font-medium text-aop-cream">Retry from step</h2>
        <p className="mt-2 font-body text-sm text-aop-slate-light">
          Choose which step to restart the workflow from.
        </p>

        {uniqueSteps.length > 0 ? (
          <div className="mt-4 flex flex-col gap-1">
            {uniqueSteps.map((step) => (
              <button
                type="button"
                key={step.stepId}
                onClick={() => setSelectedStepId(step.stepId)}
                data-testid={`retry-step-option-${step.stepId}`}
                className={`flex cursor-pointer items-center gap-2 rounded-aop px-3 py-2 text-left font-mono text-xs transition-colors ${
                  selectedStepId === step.stepId
                    ? "bg-aop-amber/20 text-aop-amber"
                    : "text-aop-slate-light hover:bg-aop-charcoal hover:text-aop-cream"
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    selectedStepId === step.stepId ? "bg-aop-amber" : "bg-aop-charcoal"
                  }`}
                />
                {step.stepId}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-4 font-mono text-xs text-aop-slate-dark">
            No step history available. The task will restart from the beginning.
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            data-testid="retry-dialog-cancel"
            className="cursor-pointer rounded-aop border border-aop-charcoal px-4 py-2 font-mono text-xs text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => task && onSelect(task, selectedStepId)}
            data-testid="retry-dialog-confirm"
            className="cursor-pointer rounded-aop bg-aop-amber px-4 py-2 font-mono text-xs text-aop-black transition-colors hover:bg-aop-amber-light"
          >
            Retry
          </button>
        </div>
      </div>
    </dialog>
  );
};
