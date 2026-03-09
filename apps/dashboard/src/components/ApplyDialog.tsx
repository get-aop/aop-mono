import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBranches } from "../api/client";
import { BranchCombobox } from "./BranchCombobox";

interface ApplyDialogProps {
  open: boolean;
  repoId: string;
  defaultBranch: string | null;
  onConfirm: (targetBranch?: string) => Promise<void>;
  onCancel: () => void;
}

export const ApplyDialog = ({
  open,
  repoId,
  defaultBranch,
  onConfirm,
  onCancel,
}: ApplyDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [targetBranch, setTargetBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const loadBranches = useCallback(async () => {
    try {
      const result = await fetchBranches(repoId);
      setBranches(result.branches);
      setTargetBranch(defaultBranch ?? result.current);
    } catch {
      if (defaultBranch) setTargetBranch(defaultBranch);
    }
  }, [repoId, defaultBranch]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
      setTargetBranch("");
      setBranches([]);
      setLoading(false);
      loadBranches();
    } else {
      dialog.close();
    }
  }, [open, loadBranches]);

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

  const handleApply = useCallback(async () => {
    setLoading(true);
    try {
      await onConfirm(targetBranch.trim() || undefined);
    } finally {
      setLoading(false);
    }
  }, [targetBranch, onConfirm]);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto overflow-visible rounded-aop-lg border border-aop-charcoal bg-aop-darkest p-0 backdrop:bg-black/60"
    >
      <div className="w-96 p-6 pb-8">
        <h2 className="font-body text-base font-medium text-aop-cream">Apply Changes</h2>

        <div className="mt-4">
          <BranchCombobox
            branches={branches}
            selected={targetBranch}
            onSelect={setTargetBranch}
            disabled={loading}
            label="TARGET BRANCH"
            id="apply-target-branch"
            testId="apply-target-branch"
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            data-testid="apply-cancel"
            className="cursor-pointer rounded-aop border border-aop-charcoal px-4 py-2 font-mono text-xs text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={loading}
            data-testid="apply-confirm"
            className="cursor-pointer rounded-aop bg-aop-amber px-4 py-2 font-mono text-xs text-aop-black transition-colors hover:bg-aop-amber-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Applying..." : "Apply"}
          </button>
        </div>
      </div>
    </dialog>
  );
};
