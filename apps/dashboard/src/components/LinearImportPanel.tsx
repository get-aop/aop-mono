import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  getLinearImportOptions,
  getLinearTodoIssues,
  importLinearIssue,
  type LinearTodoIssue,
} from "../api/client";

interface RepoOption {
  id: string;
  name: string | null;
  path: string;
}

interface ImportFilters {
  projectId: string;
  assigneeId: string;
}

interface ImportOptionsState {
  loading: boolean;
  projects: Array<{ id: string; name: string }>;
  users: Array<{ id: string; label: string }>;
}

interface LinearImportPanelProps {
  repo: RepoOption | null;
  onRefresh?: () => Promise<void>;
}

export const LinearImportPanel = ({ repo, onRefresh }: LinearImportPanelProps) => {
  const [open, setOpen] = useState(false);
  const [optionsState, setOptionsState] = useState<ImportOptionsState>({
    loading: false,
    projects: [],
    users: [],
  });
  const [filters, setFilters] = useState<ImportFilters>({
    projectId: "",
    assigneeId: "",
  });
  const [issues, setIssues] = useState<LinearTodoIssue[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const repoLabel = repo ? getRepoLabel(repo) : null;
  const selectedIssue = findIssue(issues, selectedIssueId);

  useEffect(() => {
    if (!open || !repo || optionsState.loading || optionsState.projects.length > 0) {
      return;
    }

    void fetchImportOptions(setOptionsState, setError);
  }, [open, optionsState.loading, optionsState.projects.length, repo]);

  const toggleOpen = () => {
    setOpen((prev) => !prev);
    setError(null);
    setFeedback(null);
  };

  const updateFilter = (key: keyof ImportFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const loadIssues = async () => {
    if (!filters.projectId) {
      return;
    }

    setLoadingIssues(true);
    setError(null);
    setFeedback(null);
    setSelectedIssueId("");

    try {
      const nextIssues = await getLinearTodoIssues({
        projectId: filters.projectId,
        assigneeId: filters.assigneeId || undefined,
      });
      setIssues(nextIssues);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Linear issues");
    } finally {
      setLoadingIssues(false);
    }
  };

  const handleImport = async () => {
    if (!repo || !selectedIssue) {
      return;
    }

    setImporting(true);
    setError(null);
    setFeedback(null);

    try {
      await importLinearIssue({
        cwd: repo.path,
        issueIdentifier: selectedIssue.identifier,
      });
      await onRefresh?.();
      setFeedback(`Imported ${selectedIssue.identifier} into ${repoLabel}.`);
      setOpen(false);
      setIssues([]);
      setSelectedIssueId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import Linear issue");
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="border-b border-aop-charcoal bg-aop-dark/60 px-6 py-4">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <LinearImportHeader repoLabel={repoLabel} open={open} onToggle={toggleOpen} />

        {feedback ? <PanelMessage tone="success" message={feedback} /> : null}

        {open ? (
          <LinearImportBody
            repo={repo}
            optionsState={optionsState}
            filters={filters}
            issues={issues}
            selectedIssueId={selectedIssueId}
            loadingIssues={loadingIssues}
            importing={importing}
            error={error}
            onProjectChange={(value) => updateFilter("projectId", value)}
            onAssigneeChange={(value) => updateFilter("assigneeId", value)}
            onLoadIssues={() => void loadIssues()}
            onSelectIssue={setSelectedIssueId}
            onImport={() => void handleImport()}
          />
        ) : null}
      </div>
    </section>
  );
};

interface LinearImportHeaderProps {
  repoLabel: string | null;
  open: boolean;
  onToggle: () => void;
}

const LinearImportHeader = ({ repoLabel, open, onToggle }: LinearImportHeaderProps) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] tracking-wider text-aop-slate-dark">
        LINEAR INTAKE
      </span>
      <p className="font-mono text-xs text-aop-slate-light">
        {repoLabel
          ? `Create an AOP task in ${repoLabel} from a Linear TODO issue.`
          : "Pick a repository in the header, then import a Linear TODO issue into it."}
      </p>
    </div>

    <button
      type="button"
      onClick={onToggle}
      className="cursor-pointer rounded-aop border border-aop-charcoal px-3 py-2 font-mono text-xs text-aop-cream transition-colors hover:border-aop-slate-dark hover:text-aop-amber"
    >
      {open ? "Close Linear Import" : "Create from Linear"}
    </button>
  </div>
);

interface LinearImportBodyProps {
  repo: RepoOption | null;
  optionsState: ImportOptionsState;
  filters: ImportFilters;
  issues: LinearTodoIssue[];
  selectedIssueId: string;
  loadingIssues: boolean;
  importing: boolean;
  error: string | null;
  onProjectChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onLoadIssues: () => void;
  onSelectIssue: (issueId: string) => void;
  onImport: () => void;
}

const LinearImportBody = ({
  repo,
  optionsState,
  filters,
  issues,
  selectedIssueId,
  loadingIssues,
  importing,
  error,
  onProjectChange,
  onAssigneeChange,
  onLoadIssues,
  onSelectIssue,
  onImport,
}: LinearImportBodyProps) => {
  if (!repo) {
    return <EmptyRepoState />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <LinearImportFiltersCard
        loading={optionsState.loading}
        projects={optionsState.projects}
        users={optionsState.users}
        filters={filters}
        loadingIssues={loadingIssues}
        onProjectChange={onProjectChange}
        onAssigneeChange={onAssigneeChange}
        onLoadIssues={onLoadIssues}
      />

      <LinearImportIssuesCard
        issues={issues}
        selectedIssueId={selectedIssueId}
        importing={importing}
        error={error}
        onSelectIssue={onSelectIssue}
        onImport={onImport}
      />
    </div>
  );
};

interface LinearImportFiltersCardProps {
  loading: boolean;
  projects: Array<{ id: string; name: string }>;
  users: Array<{ id: string; label: string }>;
  filters: ImportFilters;
  loadingIssues: boolean;
  onProjectChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onLoadIssues: () => void;
}

const LinearImportFiltersCard = ({
  loading,
  projects,
  users,
  filters,
  loadingIssues,
  onProjectChange,
  onAssigneeChange,
  onLoadIssues,
}: LinearImportFiltersCardProps) => (
  <div className="rounded-aop-lg border border-aop-charcoal bg-aop-black/60 p-4">
    <div className="mb-4">
      <h2 className="font-mono text-xs text-aop-cream">Filter Linear Issues</h2>
      <p className="mt-1 font-mono text-[11px] leading-5 text-aop-slate-dark">
        Project is required. User narrows the TODO list when you want a single assignee.
      </p>
    </div>

    {loading ? (
      <p className="font-mono text-xs text-aop-slate-dark">Loading Linear filters...</p>
    ) : (
      <div className="flex flex-col gap-4">
        <FilterSelect
          label="Linear project"
          value={filters.projectId}
          placeholder="Select a project"
          options={projects.map((project) => ({
            value: project.id,
            label: project.name,
          }))}
          onChange={onProjectChange}
        />

        <FilterSelect
          label="Linear user"
          value={filters.assigneeId}
          placeholder="Any user"
          options={users.map((user) => ({
            value: user.id,
            label: user.label,
          }))}
          onChange={onAssigneeChange}
        />

        <button
          type="button"
          onClick={onLoadIssues}
          disabled={!filters.projectId || loadingIssues}
          className="cursor-pointer rounded-aop border border-aop-charcoal px-3 py-2 font-mono text-xs text-aop-cream transition-colors hover:border-aop-slate-dark hover:text-aop-amber disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loadingIssues ? "Loading TODO issues..." : "Show TODO issues"}
        </button>
      </div>
    )}
  </div>
);

interface FilterSelectProps {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

const FilterSelect = ({ label, value, placeholder, options, onChange }: FilterSelectProps) => (
  <label className="flex flex-col gap-1 font-mono text-[11px] text-aop-slate-light">
    <span>{label}</span>
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-aop border border-aop-charcoal bg-aop-dark px-3 py-2 text-xs text-aop-cream focus:border-aop-amber focus:outline-none"
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

interface LinearImportIssuesCardProps {
  issues: LinearTodoIssue[];
  selectedIssueId: string;
  importing: boolean;
  error: string | null;
  onSelectIssue: (issueId: string) => void;
  onImport: () => void;
}

const LinearImportIssuesCard = ({
  issues,
  selectedIssueId,
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

    {issues.length === 0 ? (
      <EmptyIssueState />
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

const EmptyRepoState = () => (
  <div className="rounded-aop border border-dashed border-aop-charcoal px-4 py-8 text-center font-mono text-xs text-aop-slate-dark">
    Select a repository in the header to import a Linear issue.
  </div>
);

const EmptyIssueState = () => (
  <div className="rounded-aop border border-dashed border-aop-charcoal px-4 py-8 text-center font-mono text-xs text-aop-slate-dark">
    Choose a project, optionally narrow by user, then load the TODO issues.
  </div>
);

const PanelMessage = ({ tone, message }: { tone: "success" | "error"; message: string }) => (
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

const fetchImportOptions = async (
  setOptionsState: Dispatch<SetStateAction<ImportOptionsState>>,
  setError: Dispatch<SetStateAction<string | null>>,
) => {
  setOptionsState((prev) => ({ ...prev, loading: true }));
  setError(null);

  try {
    const result = await getLinearImportOptions();
    setOptionsState({
      loading: false,
      projects: result.projects,
      users: result.users.map((user) => ({
        id: user.id,
        label: user.displayName || user.name,
      })),
    });
  } catch (err) {
    setOptionsState((prev) => ({ ...prev, loading: false }));
    setError(err instanceof Error ? err.message : "Failed to load Linear filters");
  }
};

const findIssue = (issues: LinearTodoIssue[], issueId: string): LinearTodoIssue | null =>
  issues.find((issue) => issue.id === issueId) ?? null;

const getRepoLabel = (repo: RepoOption): string =>
  repo.name ?? repo.path.split("/").pop() ?? repo.path;
