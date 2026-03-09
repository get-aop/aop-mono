import { useCallback, useEffect, useRef, useState } from "react";
import { getPauseContext } from "../api/client";

const APPROVAL_MESSAGE = "Approved. Proceed with the plan.";

interface ResumeDialogProps {
  open: boolean;
  repoId: string;
  taskId: string;
  onConfirm: (input: string) => Promise<void>;
  onCancel: () => void;
}

export const ResumeDialog = ({ open, repoId, taskId, onConfirm, onCancel }: ResumeDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pauseContext, setPauseContext] = useState<string | null>(null);
  const [signal, setSignal] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const isReviewMode = signal !== null && signal !== "REQUIRES_INPUT";

  const loadPauseContext = useCallback(async () => {
    try {
      const result = await getPauseContext(repoId, taskId);
      setPauseContext(result.pauseContext);
      setSignal(result.signal);
    } catch {
      setPauseContext(null);
      setSignal(null);
    }
  }, [repoId, taskId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
      setInput("");
      setLoading(false);
      setShowFeedback(false);
      setPauseContext(null);
      setSignal(null);
      loadPauseContext();
    } else {
      dialog.close();
    }
  }, [open, loadPauseContext]);

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

  const handleConfirm = useCallback(
    async (value: string) => {
      setLoading(true);
      try {
        await onConfirm(value);
      } finally {
        setLoading(false);
      }
    },
    [onConfirm],
  );

  const handleApprove = useCallback(() => handleConfirm(APPROVAL_MESSAGE), [handleConfirm]);

  const handleSubmitFeedback = useCallback(() => {
    if (!input.trim()) return;
    handleConfirm(input.trim());
  }, [input, handleConfirm]);

  const handleResume = useCallback(() => {
    if (!input.trim()) return;
    handleConfirm(input.trim());
  }, [input, handleConfirm]);

  return (
    <dialog
      ref={dialogRef}
      data-testid="resume-dialog"
      className="m-auto overflow-visible rounded-aop-lg border border-aop-charcoal bg-aop-darkest p-0 backdrop:bg-black/60"
    >
      <div className="w-[28rem] p-6 pb-8">
        <h2 className="font-body text-base font-medium text-aop-cream">
          {isReviewMode ? "Review" : "Resume Task"}
        </h2>

        {pauseContext && (
          <div className="mt-3 rounded-aop border border-aop-amber/30 bg-aop-amber/[0.06] p-3">
            <span className="font-mono text-[10px] text-aop-amber">
              {isReviewMode ? "REVIEW" : "AGENT NEEDS"}
            </span>
            <div
              className="mt-1 whitespace-pre-wrap font-mono text-xs text-aop-cream"
              data-testid="pause-context"
            >
              {isReviewMode ? pauseContext : parsePauseContext(pauseContext)}
            </div>
          </div>
        )}

        {isReviewMode ? (
          <ReviewModeActions
            loading={loading}
            showFeedback={showFeedback}
            input={input}
            onInputChange={setInput}
            onApprove={handleApprove}
            onRequestChanges={() => setShowFeedback(true)}
            onSubmitFeedback={handleSubmitFeedback}
            onCancel={onCancel}
          />
        ) : (
          <InputModeActions
            loading={loading}
            input={input}
            onInputChange={setInput}
            onResume={handleResume}
            onCancel={onCancel}
          />
        )}
      </div>
    </dialog>
  );
};

interface ReviewModeActionsProps {
  loading: boolean;
  showFeedback: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onSubmitFeedback: () => void;
  onCancel: () => void;
}

const ReviewModeActions = ({
  loading,
  showFeedback,
  input,
  onInputChange,
  onApprove,
  onRequestChanges,
  onSubmitFeedback,
  onCancel,
}: ReviewModeActionsProps) => (
  <>
    {showFeedback && (
      <div className="mt-4">
        <label
          htmlFor="resume-input"
          className="mb-1 block font-mono text-[10px] text-aop-slate-dark"
        >
          FEEDBACK
        </label>
        <textarea
          id="resume-input"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={loading}
          placeholder="Describe the changes you'd like..."
          data-testid="resume-input"
          rows={4}
          className="w-full resize-none rounded-aop border border-aop-charcoal bg-aop-dark px-3 py-2 font-mono text-xs text-aop-cream placeholder:text-aop-slate-dark focus:border-aop-amber focus:outline-none disabled:opacity-50"
        />
      </div>
    )}

    <div className="mt-6 flex justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        data-testid="resume-cancel"
        className="cursor-pointer rounded-aop border border-aop-charcoal px-4 py-2 font-mono text-xs text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cancel
      </button>
      {showFeedback ? (
        <button
          type="button"
          onClick={onSubmitFeedback}
          disabled={loading || !input.trim()}
          data-testid="submit-feedback"
          className="cursor-pointer rounded-aop bg-aop-amber px-4 py-2 font-mono text-xs text-aop-black transition-colors hover:bg-aop-amber-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send Feedback"}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={onRequestChanges}
            disabled={loading}
            data-testid="request-changes"
            className="cursor-pointer rounded-aop border border-aop-amber px-4 py-2 font-mono text-xs text-aop-amber transition-colors hover:bg-aop-amber/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Request Changes
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={loading}
            data-testid="approve"
            className="cursor-pointer rounded-aop bg-aop-amber px-4 py-2 font-mono text-xs text-aop-black transition-colors hover:bg-aop-amber-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Approving..." : "Approve"}
          </button>
        </>
      )}
    </div>
  </>
);

interface InputModeActionsProps {
  loading: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onResume: () => void;
  onCancel: () => void;
}

const InputModeActions = ({
  loading,
  input,
  onInputChange,
  onResume,
  onCancel,
}: InputModeActionsProps) => (
  <>
    <div className="mt-4">
      <label
        htmlFor="resume-input"
        className="mb-1 block font-mono text-[10px] text-aop-slate-dark"
      >
        YOUR INPUT
      </label>
      <textarea
        id="resume-input"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        disabled={loading}
        placeholder="Provide the information the agent needs..."
        data-testid="resume-input"
        rows={4}
        className="w-full resize-none rounded-aop border border-aop-charcoal bg-aop-dark px-3 py-2 font-mono text-xs text-aop-cream placeholder:text-aop-slate-dark focus:border-aop-amber focus:outline-none disabled:opacity-50"
      />
    </div>

    <div className="mt-6 flex justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        data-testid="resume-cancel"
        className="cursor-pointer rounded-aop border border-aop-charcoal px-4 py-2 font-mono text-xs text-aop-slate-light transition-colors hover:border-aop-slate-dark hover:text-aop-cream disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onResume}
        disabled={loading || !input.trim()}
        data-testid="resume-confirm"
        className="cursor-pointer rounded-aop bg-aop-amber px-4 py-2 font-mono text-xs text-aop-black transition-colors hover:bg-aop-amber-light disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Resuming..." : "Resume"}
      </button>
    </div>
  </>
);

const parsePauseContext = (context: string): string => {
  return context.replace(/^INPUT_REASON:\s*/m, "Reason: ").replace(/^INPUT_TYPE:\s*/m, "Type: ");
};
