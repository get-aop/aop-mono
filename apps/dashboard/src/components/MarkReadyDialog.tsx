import { useCallback, useEffect, useRef, useState } from "react";

interface MarkReadyDialogProps {
  open: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export const MarkReadyDialog = ({ open, onConfirm, onCancel }: MarkReadyDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
      setLoading(false);
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

  const handleStart = useCallback(async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  }, [onConfirm]);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto overflow-visible rounded-aop-lg border border-aop-charcoal bg-aop-darkest p-0 backdrop:bg-black/60"
    >
      <div className="w-96 p-6 pb-8">
        <h2 className="font-body text-base font-medium text-aop-cream">Mark Ready</h2>
        <p className="mt-3 font-mono text-xs leading-5 text-aop-slate-light">
          This will move the task to <span className="text-aop-cream">READY</span> so the
          orchestrator can pick it up using the current AOP configuration.
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            data-testid="mark-ready-cancel"
            className="cursor-pointer rounded-aop border border-aop-charcoal px-4 py-2 font-mono text-xs text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={loading}
            data-testid="mark-ready-start"
            className="cursor-pointer rounded-aop bg-aop-amber px-4 py-2 font-mono text-xs text-aop-black transition-colors hover:bg-aop-amber-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Starting..." : "Start Task"}
          </button>
        </div>
      </div>
    </dialog>
  );
};
