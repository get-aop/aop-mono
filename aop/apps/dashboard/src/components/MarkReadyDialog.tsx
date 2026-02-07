import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBranches, fetchWorkflows } from "../api/client";
import { BranchCombobox } from "./BranchCombobox";

interface MarkReadyDialogProps {
  open: boolean;
  repoId: string;
  onConfirm: (workflow: string, baseBranch: string) => Promise<void>;
  onCancel: () => void;
}

const DEFAULT_WORKFLOW = "aop-default";

export const MarkReadyDialog = ({ open, repoId, onConfirm, onCancel }: MarkReadyDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [workflows, setWorkflows] = useState<string[]>([DEFAULT_WORKFLOW]);
  const [selectedWorkflow, setSelectedWorkflow] = useState(DEFAULT_WORKFLOW);
  const [loading, setLoading] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");

  const loadData = useCallback(async () => {
    const [workflowResult, branchResult] = await Promise.allSettled([
      fetchWorkflows(),
      fetchBranches(repoId),
    ]);

    if (workflowResult.status === "fulfilled" && workflowResult.value.length > 0) {
      setWorkflows(workflowResult.value);
    }

    if (branchResult.status === "fulfilled") {
      setBranches(branchResult.value.branches);
      setSelectedBranch(branchResult.value.current);
    }
  }, [repoId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
      setSelectedWorkflow(DEFAULT_WORKFLOW);
      setSelectedBranch("");
      setBranches([]);
      setLoading(false);
      loadData();
    } else {
      dialog.close();
    }
  }, [open, loadData]);

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
      await onConfirm(selectedWorkflow, selectedBranch);
    } finally {
      setLoading(false);
    }
  }, [selectedBranch, selectedWorkflow, onConfirm]);

  return (
    <dialog
      ref={dialogRef}
      className="m-auto overflow-visible rounded-aop-lg border border-aop-charcoal bg-aop-darkest p-0 backdrop:bg-black/60"
    >
      <div className="w-96 p-6 pb-8">
        <h2 className="font-body text-base font-medium text-aop-cream">Mark Ready</h2>

        <div className="mt-4 flex flex-col gap-3">
          <BranchCombobox
            branches={branches}
            selected={selectedBranch}
            onSelect={setSelectedBranch}
            disabled={loading}
            label="BASE BRANCH"
            id="mark-ready-base-branch"
            testId="mark-ready-base-branch"
          />

          <div>
            <label
              htmlFor="mark-ready-workflow"
              className="mb-1 block font-mono text-[10px] text-aop-slate-dark"
            >
              WORKFLOW
            </label>
            <select
              id="mark-ready-workflow"
              value={selectedWorkflow}
              onChange={(e) => setSelectedWorkflow(e.target.value)}
              disabled={loading}
              data-testid="mark-ready-workflow"
              className="w-full rounded-aop border border-aop-charcoal bg-aop-dark px-3 py-1.5 font-mono text-xs text-aop-cream focus:border-aop-amber focus:outline-none disabled:opacity-50"
            >
              {workflows.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
        </div>

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
            {loading ? "Starting..." : "Start"}
          </button>
        </div>
      </div>
    </dialog>
  );
};
