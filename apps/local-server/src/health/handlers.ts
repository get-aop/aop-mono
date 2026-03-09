import type { OrchestratorStatus } from "../app.ts";
import type { LocalServerContext } from "../context.ts";

export interface HealthDeps {
  ctx: LocalServerContext;
  startTimeMs: number;
  orchestratorStatus?: () => OrchestratorStatus;
}

export const getHealth = async (deps: HealthDeps): Promise<Record<string, unknown>> => {
  const { ctx, startTimeMs, orchestratorStatus } = deps;
  const uptimeMs = Date.now() - startTimeMs;
  const uptimeSecs = Math.floor(uptimeMs / 1000);

  const dbConnected = await checkDbConnection(ctx);

  return {
    ok: true,
    service: "aop",
    uptime: uptimeSecs,
    db: { connected: dbConnected },
    orchestrator: orchestratorStatus?.() ?? {
      watcher: "stopped",
      ticker: "stopped",
      processor: "stopped",
    },
  };
};

const checkDbConnection = async (ctx: LocalServerContext): Promise<boolean> => {
  try {
    await ctx.settingsRepository.get("max_concurrent_tasks");
    return true;
  } catch {
    return false;
  }
};
