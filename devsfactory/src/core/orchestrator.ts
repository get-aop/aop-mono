import { EventEmitter } from "node:events";
import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  updateSubtaskStatus as parserUpdateSubtaskStatus,
  recordPhaseDuration,
  updateSubtaskTiming,
  updateTaskStatus,
  updateTaskTiming
} from "../parser";
import {
  getCompletingTaskPrompt,
  getCompletionReviewPrompt,
  getConflictSolverPrompt,
  getImplementationPrompt,
  getReviewPrompt
} from "../prompts";
import { createProvider, type LLMProvider } from "../providers";
import type {
  AgentProcess,
  Config,
  OrchestratorState,
  PhaseTimings,
  Subtask,
  Task
} from "../types";
import { AgentRunner } from "./agent-runner";
import {
  createSubtaskWorktree,
  createTaskWorktree,
  deleteWorktree,
  mergeSubtaskIntoTask
} from "./git";
import type { AgentRegistry, RunningAgent } from "./interfaces/agent-registry";
import type { JobQueue } from "./interfaces/job-queue";
import { MemoryQueue } from "./local/memory-queue";
import { MemoryAgentRegistry } from "./local/memory-registry";
import { LogStorage } from "./log-storage";
import { JobProducer } from "./producer/job-producer";
import { DevsfactoryWatcher } from "./watcher";
import { createHandlerRegistry, type HandlerContext } from "./worker/handlers";
import { JobWorker } from "./worker/job-worker";

export interface OrchestratorQueueOptions {
  queue?: JobQueue & EventEmitter;
  registry?: AgentRegistry & EventEmitter;
  producer?: JobProducer;
}

interface AgentContext {
  taskFolder: string;
  subtaskFile?: string;
}

export class Orchestrator extends EventEmitter {
  private config: Config;
  private watcher: DevsfactoryWatcher;
  private agentRunner: AgentRunner;
  private state: OrchestratorState;
  private provider: LLMProvider;
  private queue: JobQueue & EventEmitter;
  private registry: AgentRegistry & EventEmitter;
  private producer: JobProducer;
  private worker: JobWorker;
  private logStorage: LogStorage;
  private runningAgents = new Map<string, AgentContext>();
  private reconciling = false;
  private reconcileQueued = false;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private subtaskStartTimes = new Map<string, number>();

  constructor(
    config: Config,
    agentRunner?: AgentRunner,
    queueOptions?: OrchestratorQueueOptions
  ) {
    super();
    this.config = config;
    this.agentRunner = agentRunner ?? new AgentRunner();
    this.watcher = new DevsfactoryWatcher(config);
    this.provider = createProvider("claude");
    this.logStorage = new LogStorage(this.getRepoRoot());

    this.queue = queueOptions?.queue ?? new MemoryQueue();
    this.registry = queueOptions?.registry ?? new MemoryAgentRegistry();
    this.producer =
      queueOptions?.producer ?? new JobProducer(this.queue, this.registry);

    const handlerContext: HandlerContext = {
      registry: this.registry,
      worktreesDir: this.config.worktreesDir,
      spawnAgent: async (opts) => {
        const prompt = await this.getPromptForJob(
          opts.type,
          opts.taskFolder,
          opts.subtaskFile
        );
        const agentProcess = await this.agentRunner.spawn({
          ...opts,
          prompt,
          provider: this.provider
        });
        return this.waitForAgentExit(agentProcess);
      },
      mergeSubtask: (taskFolder, subtaskSlug) =>
        mergeSubtaskIntoTask(this.getRepoRoot(), taskFolder, subtaskSlug),
      deleteWorktree: (path) => deleteWorktree(this.getRepoRoot(), path),
      updateSubtaskStatus: (taskFolder, subtaskFile, status) =>
        parserUpdateSubtaskStatus(
          taskFolder,
          subtaskFile,
          status,
          this.config.devsfactoryDir
        )
    };

    this.worker = new JobWorker(
      this.queue,
      this.registry,
      createHandlerRegistry(handlerContext),
      {
        maxConcurrentAgents: this.config.maxConcurrentAgents,
        retryBackoff: this.config.retryBackoff
      }
    );

    this.state = {
      tasks: [],
      plans: {},
      subtasks: {}
    };
  }

  async start(): Promise<void> {
    await mkdir(this.config.devsfactoryDir, { recursive: true });

    const scanResult = await this.watcher.scan(this.config.devsfactoryDir);
    this.state.tasks = scanResult.tasks;
    this.state.plans = scanResult.plans;
    this.state.subtasks = scanResult.subtasks;

    await this.runRecovery();

    this.watcher.start(this.config.devsfactoryDir);
    this.subscribeToWatcherEvents();
    this.subscribeToWorkerEvents();
    this.subscribeToAgentRunnerEvents();
    this.worker.start();

    await this.reconcile();
    this.startReconcileTicker();
  }

  private startReconcileTicker(): void {
    this.reconcileTimer = setInterval(() => {
      this.scheduleReconcile();
    }, 15_000);
  }

  async stop(): Promise<void> {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this.watcher.stop();
    this.worker.stop();

    const activeAgents = this.agentRunner.getActive();
    for (const agent of activeAgents) {
      await this.agentRunner.kill(agent.id);
    }

    this.emit("stateChanged");
  }

  isWatching(): boolean {
    return this.watcher.isWatching();
  }

  getState(): OrchestratorState {
    return structuredClone(this.state);
  }

  async getActiveAgents(): Promise<RunningAgent[]> {
    return this.registry.getAll();
  }

  async getQueueDepth(): Promise<number> {
    return this.queue.size();
  }

  private scheduleReconcile(): void {
    if (this.reconciling) {
      this.reconcileQueued = true;
      return;
    }
    this.reconciling = true;
    this.reconcile().finally(() => {
      this.reconciling = false;
      if (this.reconcileQueued) {
        this.reconcileQueued = false;
        this.scheduleReconcile();
      }
    });
  }

  private async reconcile(): Promise<void> {
    await this.refreshState();
    await this.transitionReadyTasks();
    await this.transitionReadySubtasks();
    await this.producer.produceFromState(this.state);
    this.emit("stateChanged");
  }

  private subscribeToWatcherEvents(): void {
    const events = [
      "taskChanged",
      "planChanged",
      "subtaskChanged",
      "reviewChanged"
    ] as const;
    for (const event of events) {
      this.watcher.on(event, () => this.scheduleReconcile());
    }
  }

  private subscribeToWorkerEvents(): void {
    this.worker.on(
      "jobCompleted",
      ({
        jobId,
        job,
        durationMs
      }: {
        jobId: string;
        job: { type: string; taskFolder: string; subtaskFile?: string };
        durationMs: number;
      }) => {
        this.scheduleReconcile();
        this.emit("workerJobCompleted", { jobId, job, durationMs });

        if (job.subtaskFile) {
          const phase = this.mapJobTypeToPhase(job.type);
          if (phase) {
            recordPhaseDuration(
              job.taskFolder,
              job.subtaskFile,
              phase,
              durationMs,
              this.config.devsfactoryDir
            ).catch(() => {});
          }

          if (job.type === "merge" || job.type === "conflict-solver") {
            this.emitSubtaskCompleted(job.taskFolder, job.subtaskFile);
          }
        }
      }
    );

    this.worker.on(
      "jobFailed",
      ({
        jobId,
        error,
        attempt
      }: {
        jobId: string;
        error?: string;
        attempt?: number;
      }) => {
        this.emit("workerJobFailed", { jobId, error, attempt });
      }
    );

    this.worker.on(
      "jobRetrying",
      ({
        jobId,
        attempt,
        nextRetryMs
      }: {
        jobId: string;
        attempt: number;
        nextRetryMs: number;
      }) => {
        this.emit("workerJobRetrying", { jobId, attempt, nextRetryMs });
      }
    );
  }

  private subscribeToAgentRunnerEvents(): void {
    this.agentRunner.on(
      "started",
      ({ agentId, process }: { agentId: string; process: AgentProcess }) => {
        this.runningAgents.set(agentId, {
          taskFolder: process.taskFolder,
          subtaskFile: process.subtaskFile
        });
      }
    );

    this.agentRunner.on(
      "output",
      ({ agentId, line }: { agentId: string; line: string }) => {
        const context = this.runningAgents.get(agentId);
        if (!context?.subtaskFile) return;

        this.logStorage
          .append(context.taskFolder, context.subtaskFile, line)
          .catch(() => {});
      }
    );

    this.agentRunner.on(
      "completed",
      ({ agentId }: { agentId: string; exitCode: number }) => {
        this.runningAgents.delete(agentId);
      }
    );
  }

  private getSubtaskKey(taskFolder: string, subtaskFile: string): string {
    return `${taskFolder}:${subtaskFile}`;
  }

  private emitSubtaskCompleted(taskFolder: string, subtaskFile: string): void {
    const subtasks = this.state.subtasks[taskFolder] ?? [];
    const subtask = subtasks.find((s) => s.filename === subtaskFile);
    if (!subtask) return;

    const subtaskKey = this.getSubtaskKey(taskFolder, subtaskFile);
    const startTime = this.subtaskStartTimes.get(subtaskKey);
    const durationMs = startTime ? Date.now() - startTime : 0;
    this.subtaskStartTimes.delete(subtaskKey);

    this.emit("subtaskCompleted", {
      taskFolder,
      subtaskNumber: subtask.number,
      subtaskTotal: subtasks.length,
      subtaskTitle: subtask.frontmatter.title,
      durationMs
    });
  }

  private async refreshState(): Promise<void> {
    const previousTasks = new Map(
      this.state.tasks.map((t) => [t.folder, t.frontmatter.status])
    );

    const scanResult = await this.watcher.scan(this.config.devsfactoryDir);
    this.state.tasks = scanResult.tasks;
    this.state.plans = scanResult.plans;
    this.state.subtasks = scanResult.subtasks;

    for (const task of this.state.tasks) {
      const prevStatus = previousTasks.get(task.folder);
      if (
        prevStatus &&
        prevStatus !== "DONE" &&
        task.frontmatter.status === "DONE"
      ) {
        const subtasks = this.state.subtasks[task.folder] ?? [];
        this.emit("taskCompleted", { task, subtasks });
      }
    }
  }

  private async runRecovery(): Promise<void> {
    await this.recoverInprogressTasksWithoutPlan();
    await this.detectOrphanedWorktrees();
  }

  private async recoverInprogressTasksWithoutPlan(): Promise<void> {
    for (const task of this.state.tasks) {
      if (task.frontmatter.status !== "INPROGRESS") continue;

      const plan = this.state.plans[task.folder];
      if (!plan) {
        await updateTaskStatus(
          task.folder,
          "PENDING",
          this.config.devsfactoryDir
        );
        task.frontmatter.status = "PENDING";
        this.emit("recoveryAction", {
          action: "taskResetToPending",
          taskFolder: task.folder
        });
      }
    }
  }

  private async detectOrphanedWorktrees(): Promise<void> {
    const worktreeDirs = await this.listWorktreeDirs();

    for (const worktreeDir of worktreeDirs) {
      const worktreeName = basename(worktreeDir);
      const isOrphaned = this.isWorktreeOrphaned(worktreeName);

      if (isOrphaned) {
        const taskFolder = this.extractTaskFolder(worktreeName);
        const task = this.state.tasks.find((t) => t.folder === taskFolder);

        if (task && task.frontmatter.status !== "BLOCKED") {
          await updateTaskStatus(
            taskFolder,
            "BLOCKED",
            this.config.devsfactoryDir
          );
          task.frontmatter.status = "BLOCKED";
          this.emit("recoveryAction", {
            action: "orphanedWorktreeDetected",
            taskFolder,
            worktreePath: worktreeDir
          });
        }
      }
    }
  }

  private async listWorktreeDirs(): Promise<string[]> {
    try {
      const entries = await readdir(this.config.worktreesDir, {
        withFileTypes: true
      });
      return entries
        .filter((e) => e.isDirectory())
        .map((e) => join(this.config.worktreesDir, e.name));
    } catch {
      return [];
    }
  }

  private isWorktreeOrphaned(worktreeName: string): boolean {
    if (worktreeName.includes("--")) {
      return this.isSubtaskWorktreeOrphaned(worktreeName);
    }
    const task = this.state.tasks.find((t) => t.folder === worktreeName);
    return !task || task.frontmatter.status !== "INPROGRESS";
  }

  private isSubtaskWorktreeOrphaned(worktreeName: string): boolean {
    const [taskFolder, subtaskSlug] = worktreeName.split("--");
    const subtasks = this.state.subtasks[taskFolder!] ?? [];
    const subtask = subtasks.find((s) => s.slug === subtaskSlug);
    if (!subtask) return true;
    const activeStatuses = [
      "INPROGRESS",
      "AGENT_REVIEW",
      "PENDING_MERGE",
      "MERGE_CONFLICT"
    ];
    return !activeStatuses.includes(subtask.frontmatter.status);
  }

  private extractTaskFolder(worktreeName: string): string {
    return worktreeName.split("--")[0]!;
  }

  private async transitionReadyTasks(): Promise<void> {
    for (const task of this.state.tasks) {
      if (task.frontmatter.status !== "PENDING") continue;
      if (!this.areTaskDependenciesSatisfied(task)) continue;

      await updateTaskStatus(
        task.folder,
        "INPROGRESS",
        this.config.devsfactoryDir
      );
      await updateTaskTiming(
        task.folder,
        { startedAt: new Date() },
        this.config.devsfactoryDir
      );
      task.frontmatter.status = "INPROGRESS";
      await createTaskWorktree(this.getRepoRoot(), task.folder);
    }
  }

  private async transitionReadySubtasks(): Promise<void> {
    for (const task of this.state.tasks) {
      if (task.frontmatter.status !== "INPROGRESS") continue;

      const subtasks = this.state.subtasks[task.folder] ?? [];
      for (const subtask of subtasks) {
        if (subtask.frontmatter.status !== "PENDING") continue;
        if (!this.areSubtaskDependenciesSatisfied(subtask, subtasks)) continue;

        await parserUpdateSubtaskStatus(
          task.folder,
          subtask.filename,
          "INPROGRESS",
          this.config.devsfactoryDir
        );
        await updateSubtaskTiming(
          task.folder,
          subtask.filename,
          { startedAt: new Date() },
          this.config.devsfactoryDir
        );
        subtask.frontmatter.status = "INPROGRESS";
        await createSubtaskWorktree(
          this.getRepoRoot(),
          task.folder,
          subtask.slug
        );

        this.subtaskStartTimes.set(
          this.getSubtaskKey(task.folder, subtask.filename),
          Date.now()
        );

        this.emit("subtaskStarted", {
          taskFolder: task.folder,
          subtaskNumber: subtask.number,
          subtaskTotal: subtasks.length,
          subtaskTitle: subtask.frontmatter.title
        });
      }
    }
  }

  private areTaskDependenciesSatisfied(task: Task): boolean {
    return task.frontmatter.dependencies.every((depFolder) => {
      const depTask = this.state.tasks.find((t) => t.folder === depFolder);
      return depTask?.frontmatter.status === "DONE";
    });
  }

  private areSubtaskDependenciesSatisfied(
    subtask: Subtask,
    allSubtasks: Subtask[]
  ): boolean {
    if (subtask.frontmatter.dependencies.length === 0) return true;

    const doneNumbers = new Set(
      allSubtasks
        .filter((s) => s.frontmatter.status === "DONE")
        .map((s) => s.number)
    );

    return subtask.frontmatter.dependencies.every((dep) =>
      doneNumbers.has(dep)
    );
  }

  private getRepoRoot(): string {
    return dirname(this.config.devsfactoryDir);
  }

  private async getPromptForJob(
    type: string,
    taskFolder: string,
    subtaskFile?: string
  ): Promise<string> {
    const devsfactoryDir = this.config.devsfactoryDir;

    switch (type) {
      case "implementation": {
        const subtaskPath = join(devsfactoryDir, taskFolder, subtaskFile!);
        return getImplementationPrompt(subtaskPath);
      }
      case "review": {
        const subtaskPath = join(devsfactoryDir, taskFolder, subtaskFile!);
        const reviewPath = subtaskPath.replace(/\.md$/, "-review.md");
        return getReviewPrompt(subtaskPath, reviewPath);
      }
      case "completing-task":
        return getCompletingTaskPrompt(taskFolder, devsfactoryDir);
      case "completion-review":
        return getCompletionReviewPrompt(taskFolder, devsfactoryDir);
      case "conflict-solver":
        return getConflictSolverPrompt(taskFolder, subtaskFile!);
      default:
        throw new Error(`Unknown job type: ${type}`);
    }
  }

  private waitForAgentExit(
    agentProcess: AgentProcess
  ): Promise<{ pid: number; exitCode: number }> {
    return new Promise((resolve) => {
      const handler = ({
        agentId,
        exitCode
      }: {
        agentId: string;
        exitCode: number;
      }) => {
        if (agentId === agentProcess.id) {
          this.agentRunner.off("completed", handler);
          resolve({ pid: agentProcess.pid, exitCode });
        }
      };
      this.agentRunner.on("completed", handler);
    });
  }

  private mapJobTypeToPhase(jobType: string): keyof PhaseTimings | null {
    const mapping: Record<string, keyof PhaseTimings> = {
      implementation: "implementation",
      review: "review",
      merge: "merge",
      "conflict-solver": "conflictSolver"
    };
    return mapping[jobType] ?? null;
  }
}
