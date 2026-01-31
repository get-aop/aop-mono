import { EventEmitter } from "node:events";
import type { RunConfig } from "../commands/run";
import { getLogger } from "../infra/logger";
import type { Config, OrchestratorState, ProjectConfig } from "../types";
import type { OrchestratorLike, ProjectScanResult } from "./dashboard-server";
import { Orchestrator } from "./orchestrator";
import { resolvePathsForProject } from "./path-resolver";
import { getProject, listProjects } from "./project-registry";
import { ProjectRegistryWatcher } from "./project-registry-watcher";
import { SdkAgentRunner } from "./sdk-agent-runner";

export interface MultiProjectRunnerOptions {
  maxConcurrentAgents: number;
  debounceMs: number;
  retryBackoff: {
    initialMs: number;
    maxMs: number;
    maxAttempts: number;
  };
  dashboardPort: number;
  ignorePatterns: string[];
}

interface ProjectInstance {
  config: RunConfig;
  orchestrator: Orchestrator;
  agentRunner: SdkAgentRunner;
}

export class MultiProjectRunner
  extends EventEmitter
  implements OrchestratorLike
{
  private projects = new Map<string, ProjectInstance>();
  private registryWatcher: ProjectRegistryWatcher;
  private options: MultiProjectRunnerOptions;
  private log = getLogger("orchestrator");

  getState(): OrchestratorState {
    return this.getCombinedState();
  }

  async getActiveAgents(): Promise<unknown[]> {
    const agents: unknown[] = [];
    for (const [, instance] of this.projects) {
      const projectAgents = instance.agentRunner.getActive();
      agents.push(...projectAgents);
    }
    return agents;
  }

  constructor(options: MultiProjectRunnerOptions) {
    super();
    this.options = options;
    this.registryWatcher = new ProjectRegistryWatcher();
  }

  async addProject(runConfig: RunConfig): Promise<void> {
    if (this.projects.has(runConfig.projectName)) {
      this.log.warn(`Project '${runConfig.projectName}' already running`);
      return;
    }

    const config = this.buildConfig(runConfig);
    const agentRunner = new SdkAgentRunner();
    const orchestrator = new Orchestrator(config, agentRunner);

    this.setupOrchestratorEvents(
      runConfig.projectName,
      orchestrator,
      agentRunner
    );

    this.projects.set(runConfig.projectName, {
      config: runConfig,
      orchestrator,
      agentRunner
    });

    await orchestrator.start();
    this.log.info(
      `Started orchestrator for project '${runConfig.projectName}'`
    );
    this.emit("projectStarted", { projectName: runConfig.projectName });
  }

  async removeProject(projectName: string): Promise<void> {
    const instance = this.projects.get(projectName);
    if (!instance) {
      return;
    }

    await instance.orchestrator.stop();
    this.projects.delete(projectName);
    this.log.info(`Stopped orchestrator for project '${projectName}'`);
    this.emit("projectStopped", { projectName });
  }

  async start(initialConfigs: RunConfig[]): Promise<void> {
    for (const config of initialConfigs) {
      await this.addProject(config);
    }

    this.registryWatcher.on("projectAdded", async (project: ProjectConfig) => {
      this.log.info(`New project registered: ${project.name}`);
      const paths = await resolvePathsForProject(project.name);
      if (paths) {
        await this.addProject({
          mode: paths.mode,
          projectName: paths.projectName,
          projectRoot: paths.projectRoot,
          devsfactoryDir: paths.devsfactoryDir,
          worktreesDir: paths.worktreesDir
        });
      }
    });

    this.registryWatcher.on("projectRemoved", async (projectName: string) => {
      this.log.info(`Project unregistered: ${projectName}`);
      await this.removeProject(projectName);
    });

    this.registryWatcher.on("error", (err: Error) => {
      this.log.error(`Registry watcher error: ${err.message}`);
    });

    await this.registryWatcher.start();
  }

  async stop(): Promise<void> {
    this.registryWatcher.stop();

    for (const [projectName, instance] of this.projects) {
      await instance.orchestrator.stop();
      this.log.info(`Stopped orchestrator for project '${projectName}'`);
    }
    this.projects.clear();
  }

  getProjectNames(): string[] {
    return Array.from(this.projects.keys());
  }

  getOrchestratorForProject(projectName: string): Orchestrator | undefined {
    return this.projects.get(projectName)?.orchestrator;
  }

  getCombinedState(): OrchestratorState {
    const combined: OrchestratorState = {
      tasks: [],
      plans: {},
      subtasks: {}
    };

    for (const [, instance] of this.projects) {
      const state = instance.orchestrator.getState();
      combined.tasks.push(...state.tasks);

      for (const [key, plan] of Object.entries(state.plans)) {
        combined.plans[key] = plan;
      }

      for (const [key, subtasks] of Object.entries(state.subtasks)) {
        combined.subtasks[key] = subtasks;
      }
    }

    return combined;
  }

  async listProjects(): Promise<ProjectConfig[]> {
    return listProjects();
  }

  async getProject(name: string): Promise<ProjectConfig | null> {
    return getProject(name);
  }

  async scanProject(projectName: string): Promise<ProjectScanResult> {
    const instance = this.projects.get(projectName);
    if (instance) {
      return instance.orchestrator.getState();
    }

    const paths = await resolvePathsForProject(projectName);
    if (!paths) {
      return { tasks: [], plans: {}, subtasks: {} };
    }

    const config = this.buildConfig({
      mode: paths.mode,
      projectName: paths.projectName,
      projectRoot: paths.projectRoot,
      devsfactoryDir: paths.devsfactoryDir,
      worktreesDir: paths.worktreesDir
    });

    const tempOrchestrator = new Orchestrator(config);
    const state = tempOrchestrator.getState();
    return state;
  }

  private buildConfig(runConfig: RunConfig): Config {
    return {
      maxConcurrentAgents: this.options.maxConcurrentAgents,
      devsfactoryDir: runConfig.devsfactoryDir,
      worktreesDir: runConfig.worktreesDir,
      projectRoot: runConfig.projectRoot,
      dashboardPort: this.options.dashboardPort,
      debounceMs: this.options.debounceMs,
      retryBackoff: this.options.retryBackoff,
      ignorePatterns: this.options.ignorePatterns
    };
  }

  private setupOrchestratorEvents(
    projectName: string,
    orchestrator: Orchestrator,
    agentRunner: SdkAgentRunner
  ): void {
    orchestrator.on("stateChanged", () => {
      this.emit("stateChanged", { projectName });
    });

    orchestrator.on("recoveryAction", (data) => {
      this.emit("recoveryAction", { projectName, ...data });
    });

    orchestrator.on("subtaskStarted", (data) => {
      this.emit("subtaskStarted", { projectName, ...data });
    });

    orchestrator.on("subtaskCompleted", (data) => {
      this.emit("subtaskCompleted", { projectName, ...data });
    });

    orchestrator.on("workerJobCompleted", (data) => {
      this.emit("workerJobCompleted", { projectName, ...data });
    });

    orchestrator.on("workerJobFailed", (data) => {
      this.emit("workerJobFailed", { projectName, ...data });
    });

    orchestrator.on("workerJobRetrying", (data) => {
      this.emit("workerJobRetrying", { projectName, ...data });
    });

    orchestrator.on("taskCompleted", (data) => {
      this.emit("taskCompleted", { projectName, ...data });
    });

    agentRunner.on("started", (data) => {
      this.emit("agentStarted", { projectName, ...data });
    });

    agentRunner.on("output", (data) => {
      this.emit("agentOutput", { projectName, ...data });
    });

    agentRunner.on("completed", (data) => {
      this.emit("agentCompleted", { projectName, ...data });
    });
  }
}
