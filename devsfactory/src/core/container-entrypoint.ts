#!/usr/bin/env bun
import type { RunConfig } from "../commands/run";
import { configureLogger, getLogger } from "../infra/logger";
import {
  updateSubtaskStatus as parserUpdateSubtaskStatus,
  updateTaskStatus
} from "../parser";
import { createProvider } from "../providers";
import type { SubtaskStatus, TaskStatus } from "../types";
import { BrainstormSessionManager } from "./brainstorm-session-manager";
import { DashboardServer } from "./dashboard-server";
import { deleteDraft, listDrafts, loadDraft, saveDraft } from "./draft-storage";
import { ensureGlobalDir, getGlobalDir } from "./global-bootstrap";
import { MultiProjectRunner } from "./multi-project-runner";
import { resolvePathsForProject } from "./path-resolver";
import { listProjects } from "./project-registry";

const getConfig = () => ({
  maxConcurrentAgents: Number(process.env.MAX_CONCURRENT_AGENTS ?? 2),
  dashboardPort: Number(process.env.DASHBOARD_PORT ?? 3001),
  debounceMs: Number(process.env.DEBOUNCE_MS ?? 100),
  retryBackoff: {
    initialMs: Number(process.env.RETRY_INITIAL_MS ?? 2000),
    maxMs: Number(process.env.RETRY_MAX_MS ?? 300000),
    maxAttempts: Number(process.env.RETRY_MAX_ATTEMPTS ?? 5)
  },
  ignorePatterns: []
});

const main = async () => {
  await configureLogger();
  const log = getLogger("orchestrator");

  await ensureGlobalDir();

  const config = getConfig();
  log.info("Starting AOP orchestrator container");
  log.info(`Dashboard port: ${config.dashboardPort}`);
  log.info(`Max concurrent agents: ${config.maxConcurrentAgents}`);

  const runner = new MultiProjectRunner(config);

  const projects = await listProjects();
  const initialConfigs: RunConfig[] = [];

  for (const project of projects) {
    const paths = await resolvePathsForProject(project.name);
    if (paths) {
      initialConfigs.push({
        mode: paths.mode,
        projectName: paths.projectName,
        projectRoot: paths.projectRoot,
        devsfactoryDir: paths.devsfactoryDir,
        worktreesDir: paths.worktreesDir
      });
    }
  }

  await runner.start(initialConfigs);
  log.info(`Started ${initialConfigs.length} project(s)`);

  const globalDir = getGlobalDir();
  const provider = createProvider("claude");
  const brainstormManager = new BrainstormSessionManager({
    provider,
    cwd: globalDir
  });
  const draftStorage = {
    saveDraft: (draft: Parameters<typeof saveDraft>[0]) =>
      saveDraft(draft, globalDir),
    loadDraft: (sessionId: string) => loadDraft(sessionId, globalDir),
    listDrafts: () => listDrafts(globalDir),
    deleteDraft: (sessionId: string) => deleteDraft(sessionId, globalDir)
  };

  const dashboard = new DashboardServer(runner, {
    port: config.dashboardPort,
    updateTaskStatus: async (
      folder: string,
      status: TaskStatus,
      devsfactoryDir: string
    ) => {
      await updateTaskStatus(folder, status, devsfactoryDir);
    },
    updateSubtaskStatus: async (
      folder: string,
      file: string,
      status: SubtaskStatus,
      devsfactoryDir: string
    ) => {
      await parserUpdateSubtaskStatus(folder, file, status, devsfactoryDir);
    },
    brainstormManager,
    draftStorage,
    listProjects: () => runner.listProjects(),
    getProject: (name) => runner.getProject(name),
    scanProject: (name) => runner.scanProject(name)
  });

  await dashboard.start();
  log.info(`Dashboard running on http://localhost:${dashboard.port}`);

  const shutdown = async () => {
    log.info("Shutting down...");
    await dashboard.stop();
    await runner.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
