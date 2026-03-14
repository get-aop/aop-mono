import { type Dispatch, type SetStateAction, startTransition, useEffect, useState } from "react";
import {
  fetchChangeFiles,
  getLinearImportOptions,
  getLinearTodoIssues,
  importLinearIssue,
  type LinearImportResponse,
  type LinearTodoIssue,
} from "../api/client";
import { LinearImportIssuesCard, PanelMessage } from "./LinearImportIssuesCard";

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

interface ImportProgressState {
  progress: number;
  stageLabel: string;
  detail: string;
}

const TASK_FILE_POLL_ATTEMPTS = 20;
const TASK_FILE_POLL_INTERVAL_MS = 150;
const NUMBERED_SUBTASK_FILE_REGEX = /^\d{3}-.*\.md$/;

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
  const [hasLoadedIssues, setHasLoadedIssues] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const repoLabel = repo ? getRepoLabel(repo) : null;
  const selectedIssue = findIssue(issues, selectedIssueId);
  const resetIssueState = () => {
    setIssues([]);
    setSelectedIssueId("");
    setHasLoadedIssues(false);
  };

  useEffect(() => {
    if (!open || !repo || optionsState.loading || optionsState.projects.length > 0) {
      return;
    }

    void fetchImportOptions(setOptionsState, setError);
  }, [open, optionsState.loading, optionsState.projects.length, repo]);

  const toggleOpen = () => {
    if (importing) {
      return;
    }
    setOpen((prev) => !prev);
    setError(null);
    setFeedback(null);
  };

  const updateFilter = (key: keyof ImportFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    resetIssueState();
    setError(null);
  };

  const loadIssues = async () => {
    if (!filters.projectId) {
      return;
    }

    setLoadingIssues(true);
    setError(null);
    setFeedback(null);
    resetIssueState();

    try {
      const nextIssues = await getLinearTodoIssues({
        projectId: filters.projectId,
        assigneeId: filters.assigneeId || undefined,
      });
      setIssues(nextIssues);
      setHasLoadedIssues(true);
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
    setImportProgress({
      progress: 18,
      stageLabel: "Importing Linear issue...",
      detail: "Reading the issue and writing the repo-local task package.",
    });
    setError(null);
    setFeedback(null);

    try {
      const result = await importLinearIssue({
        cwd: repo.path,
        issueIdentifier: selectedIssue.identifier,
      });
      setImportProgress({
        progress: 68,
        stageLabel: "Verifying task files...",
        detail: "Draft task, plan, and numbered subtasks",
      });
      await waitForImportedTaskArtifacts(result, setImportProgress);
      setImportProgress({
        progress: 92,
        stageLabel: "Syncing dashboard...",
        detail: "Refreshing the draft column with the completed import.",
      });
      await onRefresh?.();
      startTransition(() => {
        setFeedback(`Imported ${selectedIssue.identifier} into ${repoLabel}.`);
        setOpen(false);
        resetIssueState();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import Linear issue");
    } finally {
      setImportProgress(null);
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
            hasLoadedIssues={hasLoadedIssues}
            importing={importing}
            importProgress={importProgress}
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
  hasLoadedIssues: boolean;
  importing: boolean;
  importProgress: ImportProgressState | null;
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
  hasLoadedIssues,
  importing,
  importProgress,
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
        importing={importing}
        onProjectChange={onProjectChange}
        onAssigneeChange={onAssigneeChange}
        onLoadIssues={onLoadIssues}
      />

      <LinearImportIssuesCard
        issues={issues}
        selectedIssueId={selectedIssueId}
        hasLoadedIssues={hasLoadedIssues}
        importing={importing}
        importProgress={importProgress}
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
  importing: boolean;
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
  importing,
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
          disabled={importing}
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
          disabled={importing}
          onChange={onAssigneeChange}
        />

        <button
          type="button"
          onClick={onLoadIssues}
          disabled={!filters.projectId || loadingIssues || importing}
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
  disabled?: boolean;
  onChange: (value: string) => void;
}

const FilterSelect = ({
  label,
  value,
  placeholder,
  options,
  disabled = false,
  onChange,
}: FilterSelectProps) => (
  <label className="flex flex-col gap-1 font-mono text-[11px] text-aop-slate-light">
    <span>{label}</span>
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
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

const EmptyRepoState = () => (
  <div className="rounded-aop border border-dashed border-aop-charcoal px-4 py-8 text-center font-mono text-xs text-aop-slate-dark">
    Select a repository in the header to import a Linear issue.
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

const waitForImportedTaskArtifacts = async (
  result: LinearImportResponse,
  setImportProgress: Dispatch<SetStateAction<ImportProgressState | null>>,
) => {
  const total = result.imported.length;
  if (total === 0) {
    return;
  }

  let verifiedCount = 0;
  for (const record of result.imported) {
    await pollForTaskFiles(result.repoId, record.taskId, record.ref);
    verifiedCount += 1;
    const ratio = verifiedCount / total;
    setImportProgress({
      progress: Math.min(90, Math.round(68 + ratio * 22)),
      stageLabel: "Verifying task files...",
      detail: `${verifiedCount}/${total} imported task packages confirmed on disk.`,
    });
  }
};

const pollForTaskFiles = async (repoId: string, taskId: string, ref: string) => {
  for (let attempt = 0; attempt < TASK_FILE_POLL_ATTEMPTS; attempt += 1) {
    try {
      const files = await fetchChangeFiles(repoId, taskId);
      if (hasImportedTaskArtifacts(files)) {
        return;
      }
    } catch {
      // The task record can lag slightly behind the import response; retry briefly.
    }

    await delay(TASK_FILE_POLL_INTERVAL_MS);
  }

  throw new Error(`Imported task ${ref} is still missing task planning files.`);
};

const hasImportedTaskArtifacts = (files: string[]): boolean =>
  files.includes("task.md") &&
  files.includes("plan.md") &&
  files.some((file) => NUMBERED_SUBTASK_FILE_REGEX.test(file));

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
