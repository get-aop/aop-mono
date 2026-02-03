import { EventEmitter } from "node:events";
import { getLogger } from "../infra/logger";
import type { OrchestratorState } from "../types";
import { MemoryQueue } from "./local/memory-queue";
import { MemoryAgentRegistry } from "./local/memory-registry";
import { JobProducer } from "./producer/job-producer";
import type { AgentDispatcher } from "./remote/agent-dispatcher";
import type { ServerStateStore } from "./server-state-store";
import { JobWorker } from "./worker/job-worker";
import { RemoteJobHandler } from "./worker/remote-job-handler";

const log = getLogger("job-scheduler");

const isActiveTaskStatus = (status: string): boolean =>
  status === "PENDING" || status === "INPROGRESS";

const normalizeState = (state: OrchestratorState): OrchestratorState => ({
  ...state,
  tasks: state.tasks.filter((task) =>
    isActiveTaskStatus(task.frontmatter.status)
  )
});

export interface ServerSchedulerOptions {
  maxConcurrentAgents: number;
  retryBackoff: {
    initialMs: number;
    maxMs: number;
    maxAttempts: number;
  };
}

export class ServerScheduler extends EventEmitter {
  private queue = new MemoryQueue();
  private registry = new MemoryAgentRegistry();
  private worker: JobWorker;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private store: ServerStateStore,
    dispatcher: AgentDispatcher,
    options: ServerSchedulerOptions
  ) {
    super();

    const handler = new RemoteJobHandler(dispatcher, this.registry);
    this.worker = new JobWorker(
      this.queue,
      this.registry,
      { get: () => handler },
      {
        maxConcurrentAgents: options.maxConcurrentAgents,
        retryBackoff: options.retryBackoff
      }
    );
  }

  start(): void {
    this.worker.on("jobCompleted", (data) => this.emit("jobCompleted", data));
    this.worker.on("jobFailed", (data) => this.emit("jobFailed", data));
    this.worker.on("jobRetrying", (data) => this.emit("jobRetrying", data));
    this.worker.start();

    this.store.on("stateChanged", () => this.scheduleReconcile());
    this.scheduleReconcile();
  }

  stop(): void {
    if (this.reconcileTimer) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this.worker.stop();
    this.queue.stop();
  }

  private scheduleReconcile(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      this.reconcile().catch((error) => {
        log.error(
          `Reconcile failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }, 250);
  }

  private async reconcile(): Promise<void> {
    const projectNames = this.store.getProjectNames();
    for (const projectName of projectNames) {
      const state = normalizeState(this.store.getProjectState(projectName));
      await this.produceForProject(projectName, state);
    }
  }

  private async produceForProject(
    projectName: string,
    state: OrchestratorState
  ): Promise<void> {
    const producer = new JobProducer(this.queue, this.registry, projectName);
    await producer.produceFromState(state);
  }
}
