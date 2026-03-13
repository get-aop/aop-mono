import type { LinearTodoIssue } from "../api/client";

interface LinearImportIssuesCardProps {
  issues: LinearTodoIssue[];
  selectedIssueId: string;
  hasLoadedIssues: boolean;
  importing: boolean;
  error: string | null;
  onSelectIssue: (issueId: string) => void;
  onImport: () => void;
}

export const LinearImportIssuesCard = ({
  issues,
  selectedIssueId,
  hasLoadedIssues,
  importing,
  error,
  onSelectIssue,
  onImport,
}: LinearImportIssuesCardProps) => (
  <div className="rounded-aop-lg border border-aop-charcoal bg-aop-black/60 p-4">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="font-mono text-xs text-aop-cream">TODO Issues</h2>
        <p className="mt-1 font-mono text-[11px] leading-5 text-aop-slate-dark">
          Select one issue and import it as a repo-local AOP task.
        </p>
      </div>

      <button
        type="button"
        onClick={onImport}
        disabled={!selectedIssueId || importing}
        className="cursor-pointer rounded-aop border border-aop-charcoal px-3 py-2 font-mono text-xs text-aop-cream transition-colors hover:border-aop-slate-dark hover:text-aop-amber disabled:cursor-not-allowed disabled:opacity-40"
      >
        {importing ? "Importing..." : "Import selected issue"}
      </button>
    </div>

    {error ? <PanelMessage tone="error" message={error} /> : null}

    {error ? null : issues.length === 0 ? (
      <EmptyIssueState hasLoadedIssues={hasLoadedIssues} />
    ) : (
      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {issues.map((issue) => (
          <LinearIssueOption
            key={issue.id}
            issue={issue}
            selected={issue.id === selectedIssueId}
            onSelect={onSelectIssue}
          />
        ))}
      </div>
    )}
  </div>
);

export const PanelMessage = ({ tone, message }: { tone: "success" | "error"; message: string }) => (
  <div
    className={`rounded-aop border px-3 py-2 font-mono text-xs ${
      tone === "success"
        ? "border-aop-ready/30 bg-aop-ready/10 text-aop-ready"
        : "border-aop-blocked/30 bg-aop-blocked/10 text-aop-blocked"
    }`}
  >
    {message}
  </div>
);

interface LinearIssueOptionProps {
  issue: LinearTodoIssue;
  selected: boolean;
  onSelect: (issueId: string) => void;
}

const LinearIssueOption = ({ issue, selected, onSelect }: LinearIssueOptionProps) => (
  <label
    className={`flex cursor-pointer gap-3 rounded-aop border px-3 py-3 transition-colors ${
      selected
        ? "border-aop-amber bg-aop-amber/10"
        : "border-aop-charcoal bg-aop-dark/40 hover:border-aop-slate-dark"
    }`}
    aria-label={`${issue.identifier} ${issue.title}`}
  >
    <input
      type="radio"
      name="linear-issue"
      checked={selected}
      onChange={() => onSelect(issue.id)}
      className="mt-1"
    />
    <div className="min-w-0">
      <div className="font-mono text-xs text-aop-cream">
        {issue.identifier} {issue.title}
      </div>
      <IssueMeta issue={issue} />
    </div>
  </label>
);

const IssueMeta = ({ issue }: { issue: LinearTodoIssue }) => {
  const items = [issue.projectName, issue.assigneeName, issue.stateName].filter(
    (value): value is string => Boolean(value),
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-2 font-mono text-[10px] text-aop-slate-dark">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
};

const EmptyIssueState = ({ hasLoadedIssues }: { hasLoadedIssues: boolean }) => (
  <div className="rounded-aop border border-dashed border-aop-charcoal px-4 py-8 text-center font-mono text-xs text-aop-slate-dark">
    {hasLoadedIssues
      ? "No matching Linear issues found for this project and user filter."
      : "Choose a project, optionally narrow by user, then load the TODO issues."}
  </div>
);
