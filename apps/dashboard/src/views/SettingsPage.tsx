import { useCallback, useEffect, useState } from "react";
import {
  type CleanupResult,
  cleanupWorktrees,
  connectLinear,
  disconnectLinear,
  getLinearStatus,
  getSettings,
  type LinearConnectionInfo,
  type LinearStatus,
  testLinearConnection,
  unlockLinear,
  updateSettings,
} from "../api/client";
import { Logo } from "../components/Logo";
import { TextInput } from "../components/TextInput";
import { ToggleInput } from "../components/ToggleInput";

interface SettingsPageProps {
  onNavigate?: (path: string) => void;
}

interface SettingMeta {
  label: string;
  description: string;
  type: "number" | "text" | "password" | "toggle" | "select";
  suffix?: string;
  options?: { value: string; label: string }[];
}

interface LinearSectionState {
  status: LinearStatus | null;
  info: LinearConnectionInfo | null;
  loading: boolean;
  error: string | null;
}

interface SettingsFormProps {
  savedValues: Record<string, string>;
  editedValues: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSaved: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  linearState: LinearSectionState;
  onRefreshLinear: () => Promise<void>;
}

const GROUPS: { label: string; keys: string[] }[] = [
  {
    label: "AGENT CONFIGURATION",
    keys: ["max_concurrent_tasks", "agent_timeout_secs", "agent_provider", "fast_mode"],
  },
  {
    label: "POLLING",
    keys: ["watcher_poll_interval_secs", "queue_poll_interval_secs"],
  },
  {
    label: "REMOTE SERVER",
    keys: ["server_url", "api_key"],
  },
];

const SETTING_META: Record<string, SettingMeta> = {
  max_concurrent_tasks: {
    label: "Max Concurrent Tasks",
    description: "Maximum tasks running in parallel",
    type: "number",
  },
  watcher_poll_interval_secs: {
    label: "Watcher Poll Interval",
    description: "Seconds between file watcher polls",
    type: "number",
    suffix: "s",
  },
  queue_poll_interval_secs: {
    label: "Queue Poll Interval",
    description: "Seconds between queue processing polls",
    type: "number",
    suffix: "s",
  },
  agent_timeout_secs: {
    label: "Agent Timeout",
    description: "Time before an agent is considered timed out",
    type: "number",
    suffix: "s",
  },
  agent_provider: {
    label: "LLM Provider",
    description: "Which LLM provider the orchestrator uses for agents",
    type: "select",
    options: [
      { value: "codex", label: "Codex CLI" },
      { value: "claude-code", label: "Opus 4.6" },
      { value: "opencode:opencode/kimi-k2.5", label: "Kimi K2.5" },
      { value: "opencode:opencode/kimi-k2.5-free", label: "Kimi K2.5 Free" },
      { value: "opencode:openai/gpt-5.3-codex/medium", label: "GPT 5.3 Codex (Medium)" },
      { value: "opencode:openai/gpt-5.3-codex/high", label: "GPT 5.3 Codex (High)" },
      { value: "opencode:openai/gpt-5.3-codex/xhigh", label: "GPT 5.3 Codex (X-High)" },
      { value: "opencode:openai/gpt-5.3-codex/low", label: "GPT 5.3 Codex (Low)" },
      { value: "cursor-cli:composer-1.5", label: "Composer 1.5" },
    ],
  },
  fast_mode: {
    label: "Fast Mode",
    description: "Enable Claude Code fast mode for faster output",
    type: "toggle",
  },
  server_url: { label: "Server URL", description: "Remote server URL", type: "text" },
  api_key: { label: "API Key", description: "Remote server API key", type: "password" },
};

export const SettingsPage = ({ onNavigate }: SettingsPageProps) => {
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linearState, setLinearState] = useState<LinearSectionState>({
    status: null,
    info: null,
    loading: true,
    error: null,
  });

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSettings();
      const values: Record<string, string> = {};
      for (const setting of data) {
        values[setting.key] = setting.value;
      }
      setSavedValues(values);
      setEditedValues(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLinearState = useCallback(async () => {
    setLinearState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const status = await getLinearStatus();
      let info: LinearConnectionInfo | null = null;
      if (status.connected && !status.locked) {
        info = await testLinearConnection();
      }
      setLinearState({ status, info, loading: false, error: null });
    } catch (err) {
      setLinearState({
        status: null,
        info: null,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load Linear status",
      });
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchLinearState();
  }, [fetchLinearState, fetchSettings]);

  const handleChange = (key: string, value: string) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
  };

  let content: React.ReactNode;
  if (loading) {
    content = (
      <div className="flex items-center justify-center py-24">
        <span className="font-mono text-sm text-aop-slate-dark">Loading settings...</span>
      </div>
    );
  } else if (error) {
    content = (
      <div className="flex items-center justify-center py-24">
        <span className="font-mono text-sm text-aop-blocked">{error}</span>
      </div>
    );
  } else {
    content = (
      <SettingsForm
        savedValues={savedValues}
        editedValues={editedValues}
        onChange={handleChange}
        onSaved={setSavedValues}
        linearState={linearState}
        onRefreshLinear={fetchLinearState}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-aop-black">
      <Header onNavigate={onNavigate} />

      <main className="flex flex-1 flex-col p-6">
        <div className="mx-auto w-full max-w-xl">
          <h1 className="mb-8 font-display text-2xl font-light text-aop-cream">Settings</h1>
          {content}
        </div>
      </main>
    </div>
  );
};

const SettingsForm = ({
  savedValues,
  editedValues,
  onChange,
  onSaved,
  linearState,
  onRefreshLinear,
}: SettingsFormProps) => {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<"success" | "error" | null>(null);

  const dirtyEntries = Object.entries(editedValues).filter(
    ([key, value]) => value !== savedValues[key],
  );
  const isDirty = dirtyEntries.length > 0;

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const settings = dirtyEntries.map(([key, value]) => ({ key, value }));
      await updateSettings(settings);
      onSaved((prev) => {
        const next = { ...prev };
        for (const { key, value } of settings) {
          next[key] = value;
        }
        return next;
      });
      setFeedback("success");
    } catch {
      setFeedback("error");
    } finally {
      setSaving(false);
      setTimeout(() => setFeedback(null), 2000);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 font-mono text-[10px] tracking-wider text-aop-slate-dark">LINEAR</h2>
        <LinearConnectionSection linearState={linearState} onRefresh={onRefreshLinear} />
      </section>

      {GROUPS.map((group) => {
        const groupKeys = group.keys.filter((key) => key in savedValues);
        if (groupKeys.length === 0) return null;

        return (
          <section key={group.label}>
            <h2 className="mb-3 font-mono text-[10px] tracking-wider text-aop-slate-dark">
              {group.label}
            </h2>
            <div className="overflow-hidden rounded-aop-lg border border-aop-charcoal bg-aop-darkest">
              {groupKeys.map((key, index) => (
                <SettingRow
                  key={key}
                  settingKey={key}
                  value={editedValues[key] ?? ""}
                  onChange={onChange}
                  isLast={index === groupKeys.length - 1}
                />
              ))}
            </div>
          </section>
        );
      })}

      <div className="flex items-center justify-end gap-3">
        {feedback === "success" && (
          <span className="font-mono text-[10px] text-aop-success">Saved</span>
        )}
        {feedback === "error" && (
          <span className="font-mono text-[10px] text-aop-blocked">Save failed</span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saving}
          className={`flex h-8 cursor-pointer items-center justify-center rounded-aop px-5 font-mono text-xs transition-all disabled:cursor-default ${
            isDirty
              ? "border border-aop-amber/40 bg-aop-amber/5 text-aop-amber hover:bg-aop-amber/10"
              : "border border-aop-charcoal text-aop-charcoal"
          }`}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <section>
        <h2 className="mb-3 font-mono text-[10px] tracking-wider text-aop-slate-dark">
          MAINTENANCE
        </h2>
        <CleanupSection />
      </section>
    </div>
  );
};

const Header = ({ onNavigate }: SettingsPageProps) => (
  <header className="flex h-14 shrink-0 items-center justify-between border-b border-aop-charcoal bg-aop-dark px-6">
    <div className="flex items-center gap-6">
      <button
        type="button"
        onClick={() => onNavigate?.("/")}
        className="cursor-pointer text-aop-cream transition-colors hover:text-aop-amber"
      >
        <Logo />
      </button>
    </div>

    <nav className="flex items-center gap-6">
      <button
        type="button"
        onClick={() => onNavigate?.("/")}
        className="cursor-pointer font-mono text-xs text-aop-slate transition-colors hover:text-aop-cream"
      >
        Board
      </button>
      <button
        type="button"
        onClick={() => onNavigate?.("/metrics")}
        className="cursor-pointer font-mono text-xs text-aop-slate transition-colors hover:text-aop-cream"
      >
        Metrics
      </button>
      <span className="font-mono text-xs text-aop-cream">Settings</span>
    </nav>
  </header>
);

interface LinearConnectionSectionProps {
  linearState: LinearSectionState;
  onRefresh: () => Promise<void>;
}

type LinearBusyState = "connect" | "unlock" | "disconnect" | "refresh" | null;

const getLinearStatusLabel = (linearState: LinearSectionState): string => {
  if (linearState.loading) {
    return "Loading...";
  }

  if (!linearState.status?.connected) {
    return "Not connected";
  }

  return linearState.status.locked ? "Connected, locked" : "Connected";
};

const getLinearMessageTone = (
  linearState: LinearSectionState,
  messageTone: "success" | "error",
): string => {
  return linearState.error || messageTone === "error" ? "text-aop-blocked" : "text-aop-success";
};

const hasUnlockedConnection = (linearState: LinearSectionState): boolean => {
  return Boolean(linearState.info && linearState.status && !linearState.status.locked);
};

const getPrimaryLinearAction = ({
  busy,
  connected,
  loading,
  locked,
  onConnect,
  onUnlock,
}: {
  busy: LinearBusyState;
  connected: boolean;
  loading: boolean;
  locked: boolean;
  onConnect: () => void;
  onUnlock: () => void;
}): {
  label: string;
  onClick: () => void;
  disabled: boolean;
} | null => {
  if (!connected) {
    return {
      label: busy === "connect" ? "Connecting..." : "Connect",
      onClick: onConnect,
      disabled: loading || busy !== null,
    };
  }

  if (!locked) {
    return null;
  }

  return {
    label: busy === "unlock" ? "Unlocking..." : "Unlock",
    onClick: onUnlock,
    disabled: loading || busy !== null,
  };
};

const LinearConnectionActions = ({
  busy,
  connected,
  loading,
  locked,
  onConnect,
  onDisconnect,
  onRefresh,
  onUnlock,
}: {
  busy: LinearBusyState;
  connected: boolean;
  loading: boolean;
  locked: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onUnlock: () => void;
}) => {
  const primaryAction = getPrimaryLinearAction({
    busy,
    connected,
    loading,
    locked,
    onConnect,
    onUnlock,
  });

  return (
    <div className="flex shrink-0 items-center gap-2">
      {primaryAction && <ActionButton {...primaryAction} />}

      <ActionButton
        label={busy === "refresh" ? "Refreshing..." : "Refresh"}
        onClick={onRefresh}
        disabled={busy !== null}
        subtle
      />

      {connected && (
        <ActionButton
          label={busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
          onClick={onDisconnect}
          disabled={busy !== null}
          destructive
        />
      )}
    </div>
  );
};

const LinearConnectionSection = ({ linearState, onRefresh }: LinearConnectionSectionProps) => {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState<LinearBusyState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

  const showMessage = (nextMessage: string, tone: "success" | "error") => {
    setMessage(nextMessage);
    setMessageTone(tone);
  };

  const runAction = async (
    nextBusy: Exclude<LinearBusyState, null>,
    action: () => Promise<void>,
  ) => {
    setBusy(nextBusy);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const requirePassphrase = (): boolean => {
    if (passphrase) {
      return true;
    }
    showMessage("Passphrase required", "error");
    return false;
  };

  const handleConnect = async () => {
    if (!requirePassphrase()) {
      return;
    }

    await runAction("connect", async () => {
      const result = await connectLinear(passphrase);
      globalThis.open?.(result.authorizeUrl, "_blank", "noopener,noreferrer");
      showMessage("Authorization opened in browser", "success");
    }).catch((err) => {
      showMessage(err instanceof Error ? err.message : "Failed to start Linear OAuth", "error");
    });
  };

  const handleUnlock = async () => {
    if (!requirePassphrase()) {
      return;
    }

    await runAction("unlock", async () => {
      await unlockLinear(passphrase);
      setPassphrase("");
      await onRefresh();
      showMessage("Linear unlocked", "success");
    }).catch((err) => {
      showMessage(err instanceof Error ? err.message : "Failed to unlock Linear", "error");
    });
  };

  const handleDisconnect = async () => {
    await runAction("disconnect", async () => {
      await disconnectLinear();
      setPassphrase("");
      await onRefresh();
      showMessage("Linear disconnected", "success");
    }).catch((err) => {
      showMessage(err instanceof Error ? err.message : "Failed to disconnect Linear", "error");
    });
  };

  const handleRefresh = async () => {
    await runAction("refresh", async () => {
      await onRefresh();
    });
  };

  return (
    <div className="overflow-hidden rounded-aop-lg border border-aop-charcoal bg-aop-darkest">
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xs text-aop-cream">Linear</div>
            <p className="mt-0.5 font-mono text-[10px] text-aop-slate-dark">
              Connect AOP to Linear without storing OAuth secrets in SQLite.
            </p>
          </div>
          <div className="shrink-0 font-mono text-[10px] text-aop-cream">
            {getLinearStatusLabel(linearState)}
          </div>
        </div>

        {(linearState.error || message) && (
          <div
            className={`font-mono text-[10px] ${getLinearMessageTone(linearState, messageTone)}`}
          >
            {linearState.error ?? message}
          </div>
        )}

        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="linear-passphrase"
              className="mb-1 block font-mono text-xs text-aop-cream"
            >
              Linear passphrase
            </label>
            <TextInput
              id="linear-passphrase"
              type="password"
              value={passphrase}
              onChange={setPassphrase}
            />
          </div>
          <LinearConnectionActions
            busy={busy}
            connected={Boolean(linearState.status?.connected)}
            loading={linearState.loading}
            locked={Boolean(linearState.status?.locked)}
            onConnect={() => {
              void handleConnect();
            }}
            onDisconnect={() => {
              void handleDisconnect();
            }}
            onRefresh={() => {
              void handleRefresh();
            }}
            onUnlock={() => {
              void handleUnlock();
            }}
          />
        </div>

        {hasUnlockedConnection(linearState) && linearState.info && (
          <div className="grid gap-2 rounded-aop border border-aop-charcoal/60 bg-aop-dark px-3 py-3 md:grid-cols-3">
            <ConnectionField label="Workspace" value={linearState.info.organizationName} />
            <ConnectionField label="User" value={linearState.info.userName} />
            <ConnectionField label="Email" value={linearState.info.userEmail} />
          </div>
        )}
      </div>
    </div>
  );
};

const ActionButton = ({
  label,
  onClick,
  disabled,
  destructive = false,
  subtle = false,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  destructive?: boolean;
  subtle?: boolean;
}) => {
  const colorClass = destructive
    ? "border-aop-blocked/40 bg-aop-blocked/5 text-aop-blocked hover:bg-aop-blocked/10"
    : subtle
      ? "border-aop-charcoal text-aop-slate-light hover:text-aop-cream"
      : "border-aop-amber/40 bg-aop-amber/5 text-aop-amber hover:bg-aop-amber/10";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 cursor-pointer items-center justify-center rounded-aop border px-3 font-mono text-[10px] transition-colors disabled:cursor-default disabled:opacity-50 ${colorClass}`}
    >
      {label}
    </button>
  );
};

const ConnectionField = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <div className="font-mono text-[10px] text-aop-slate-dark">{label}</div>
    <div className="truncate font-mono text-xs text-aop-cream">{value}</div>
  </div>
);

interface SettingRowProps {
  settingKey: string;
  value: string;
  onChange: (key: string, value: string) => void;
  isLast: boolean;
}

const SettingRow = ({ settingKey, value, onChange, isLast }: SettingRowProps) => {
  const meta = SETTING_META[settingKey] ?? { label: settingKey, description: "", type: "text" };
  const inputId = `setting-${settingKey}`;

  return (
    <div
      className={`flex items-center gap-4 px-4 py-3 ${isLast ? "" : "border-b border-aop-charcoal/60"}`}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="font-mono text-xs text-aop-cream">
          {meta.label}
        </label>
        <p className="mt-0.5 truncate font-mono text-[10px] text-aop-slate-dark">
          {meta.description}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <SettingInput
          id={inputId}
          meta={meta}
          value={value}
          onChange={(nextValue: string) => onChange(settingKey, nextValue)}
        />
      </div>
    </div>
  );
};

interface SettingInputProps {
  id: string;
  meta: SettingMeta;
  value: string;
  onChange: (value: string) => void;
}

const SettingInput = ({ id, meta, value, onChange }: SettingInputProps) => {
  if (meta.type === "toggle") {
    return (
      <ToggleInput
        id={id}
        checked={value === "true"}
        onChange={(checked: boolean) => onChange(checked ? "true" : "false")}
      />
    );
  }

  if (meta.type === "select" && meta.options) {
    return (
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-aop border border-aop-charcoal bg-aop-dark px-3 py-1.5 font-mono text-xs text-aop-cream focus:border-aop-amber focus:outline-none"
      >
        {meta.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <TextInput
      id={id}
      type={meta.type === "password" ? "password" : "text"}
      inputMode={meta.type === "number" ? "numeric" : undefined}
      value={value}
      onChange={onChange}
      suffix={meta.suffix}
      compact={meta.type === "number"}
    />
  );
};

const CleanupSection = () => {
  const [confirming, setConfirming] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);

  const handleCleanup = async () => {
    setCleaning(true);
    setResult(null);
    try {
      const response = await cleanupWorktrees();
      setResult(response);
    } catch {
      setResult({ cleaned: 0, failed: -1 });
    } finally {
      setCleaning(false);
      setConfirming(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-aop-lg border border-aop-charcoal bg-aop-darkest">
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-aop-cream">Cleanup Removed Worktrees</div>
          <p className="mt-0.5 font-mono text-[10px] text-aop-slate-dark">
            Force-remove worktrees for all tasks with REMOVED status
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {result && (
            <span className="font-mono text-[10px]">
              {result.failed === -1 ? (
                <span className="text-aop-blocked">Failed</span>
              ) : (
                <span className={result.cleaned > 0 ? "text-aop-success" : "text-aop-slate-dark"}>
                  {result.cleaned} cleaned
                  {result.failed > 0 && (
                    <span className="text-aop-blocked"> / {result.failed} failed</span>
                  )}
                </span>
              )}
            </span>
          )}

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={cleaning}
              className="flex h-7 w-14 cursor-pointer items-center justify-center rounded-aop border border-aop-charcoal font-mono text-[10px] text-aop-slate transition-colors hover:border-aop-blocked/40 hover:text-aop-blocked disabled:cursor-default disabled:opacity-30"
            >
              Clean
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCleanup}
                disabled={cleaning}
                className="flex h-7 cursor-pointer items-center justify-center rounded-aop border border-aop-blocked/40 bg-aop-blocked/5 px-2.5 font-mono text-[10px] text-aop-blocked transition-colors hover:bg-aop-blocked/10 disabled:cursor-default disabled:opacity-50"
              >
                {cleaning ? "..." : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={cleaning}
                className="flex h-7 cursor-pointer items-center justify-center rounded-aop border border-aop-charcoal px-2.5 font-mono text-[10px] text-aop-slate-light transition-colors hover:text-aop-cream disabled:cursor-default disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
