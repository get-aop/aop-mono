import type { TaskStatus } from "@aop/common";
import { useEffect, useMemo, useState } from "react";
import { getMetrics, getStatus } from "../api/client";
import { Logo } from "../components/Logo";
import { RepoFilter } from "../components/RepoFilter";
import type { Metrics } from "../types";

interface MetricsPageProps {
  onNavigate?: (path: string) => void;
}

export const MetricsPage = ({ onNavigate }: MetricsPageProps) => {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [repos, setRepos] = useState<{ id: string; name: string | null; path: string }[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStatus()
      .then((status) => setRepos(status.repos))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getMetrics(selectedRepoId ?? undefined)
      .then(setMetrics)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedRepoId]);

  return (
    <div className="flex min-h-screen flex-col bg-aop-black">
      <Header
        repos={repos}
        selectedRepoId={selectedRepoId}
        onRepoChange={setSelectedRepoId}
        onNavigate={onNavigate}
      />

      <main className="flex flex-1 flex-col p-6">
        <div className="mx-auto w-full max-w-5xl">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} />
          ) : metrics ? (
            <MetricsGrid metrics={metrics} />
          ) : null}
        </div>
      </main>
    </div>
  );
};

interface HeaderProps {
  repos: { id: string; name: string | null; path: string }[];
  selectedRepoId: string | null;
  onRepoChange: (repoId: string | null) => void;
  onNavigate?: (path: string) => void;
}

const Header = ({ repos, selectedRepoId, onRepoChange, onNavigate }: HeaderProps) => (
  <header className="flex h-14 shrink-0 items-center justify-between border-b border-aop-charcoal bg-aop-dark px-6">
    <div className="flex items-center gap-6">
      <button
        type="button"
        onClick={() => onNavigate?.("/")}
        className="cursor-pointer text-aop-cream transition-colors hover:text-aop-amber"
      >
        <Logo />
      </button>
      <RepoFilter repos={repos} selectedRepoId={selectedRepoId} onChange={onRepoChange} />
    </div>

    <nav className="flex items-center gap-6">
      <button
        type="button"
        onClick={() => onNavigate?.("/")}
        className="cursor-pointer font-mono text-xs text-aop-slate transition-colors hover:text-aop-cream"
      >
        Board
      </button>
      <span className="font-mono text-xs text-aop-cream">Metrics</span>
    </nav>
  </header>
);

const LoadingState = () => (
  <div className="flex items-center justify-center py-24">
    <span className="font-mono text-sm text-aop-slate-dark">Loading metrics...</span>
  </div>
);

const ErrorState = ({ message }: { message: string }) => (
  <div className="flex items-center justify-center py-24">
    <span className="font-mono text-sm text-aop-blocked">{message}</span>
  </div>
);

interface MetricsGridProps {
  metrics: Metrics;
}

const MetricsGrid = ({ metrics }: MetricsGridProps) => {
  const formattedSuccessRate = useMemo(() => {
    if (Number.isNaN(metrics.successRate)) return "—";
    return `${Math.round(metrics.successRate * 100)}%`;
  }, [metrics.successRate]);

  const formattedAvgDuration = useMemo(
    () => formatDuration(metrics.avgDurationMs),
    [metrics.avgDurationMs],
  );
  const formattedFailedDuration = useMemo(
    () => formatDuration(metrics.avgFailedDurationMs),
    [metrics.avgFailedDurationMs],
  );

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-4 font-mono text-xs text-aop-slate-dark">OVERVIEW</h2>
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="TOTAL TASKS" value={metrics.total} />
          <MetricCard
            label="SUCCESS RATE"
            value={formattedSuccessRate}
            valueColor={getSuccessRateColor(metrics.successRate)}
          />
          <MetricCard label="ACTIVE" value={metrics.byStatus.WORKING + metrics.byStatus.READY} />
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-mono text-xs text-aop-slate-dark">TASKS BY STATUS</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatusCard status="DRAFT" count={metrics.byStatus.DRAFT} />
          <StatusCard status="READY" count={metrics.byStatus.READY} />
          <StatusCard status="WORKING" count={metrics.byStatus.WORKING} />
          <StatusCard status="DONE" count={metrics.byStatus.DONE} />
          <StatusCard status="BLOCKED" count={metrics.byStatus.BLOCKED} />
          <StatusCard status="REMOVED" count={metrics.byStatus.REMOVED} />
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-mono text-xs text-aop-slate-dark">DURATION</h2>
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            label="AVG COMPLETED"
            value={formattedAvgDuration}
            sublabel="successful tasks"
          />
          <MetricCard label="AVG FAILED" value={formattedFailedDuration} sublabel="blocked tasks" />
        </div>
      </section>
    </div>
  );
};

interface MetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  valueColor?: string;
}

const MetricCard = ({ label, value, sublabel, valueColor = "text-aop-cream" }: MetricCardProps) => (
  <div className="rounded-aop border border-aop-charcoal bg-aop-darkest p-6">
    <div className="font-mono text-[10px] text-aop-slate-dark">{label}</div>
    <div className={`mt-2 font-display text-4xl font-light ${valueColor}`}>{value}</div>
    {sublabel && <div className="mt-1 font-mono text-[10px] text-aop-slate-dark">{sublabel}</div>}
  </div>
);

interface StatusCardProps {
  status: TaskStatus;
  count: number;
}

const statusColors: Record<TaskStatus, { dot: string; text: string }> = {
  DRAFT: { dot: "bg-aop-charcoal", text: "text-aop-slate" },
  READY: { dot: "bg-aop-amber", text: "text-aop-amber" },
  WORKING: { dot: "bg-aop-working", text: "text-aop-working" },
  DONE: { dot: "bg-aop-success", text: "text-aop-success" },
  BLOCKED: { dot: "bg-aop-blocked", text: "text-aop-blocked" },
  REMOVED: { dot: "bg-aop-slate-dark", text: "text-aop-slate-dark" },
};

const StatusCard = ({ status, count }: StatusCardProps) => {
  const colors = statusColors[status];

  return (
    <div className="rounded-aop border border-aop-charcoal bg-aop-darkest p-4">
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${colors.dot}`} />
        <span className="font-mono text-[10px] text-aop-slate-dark">{status}</span>
      </div>
      <div className={`mt-2 font-display text-3xl font-light ${colors.text}`}>{count}</div>
    </div>
  );
};

const formatDuration = (ms: number): string => {
  if (!ms || Number.isNaN(ms)) return "—";

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

const getSuccessRateColor = (rate: number): string => {
  if (Number.isNaN(rate)) return "text-aop-slate-dark";
  if (rate >= 0.8) return "text-aop-success";
  if (rate >= 0.5) return "text-aop-amber";
  return "text-aop-blocked";
};
