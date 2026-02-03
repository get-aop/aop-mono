import { EventEmitter } from "node:events";
import { getLogger } from "../infra/logger";
import type { OrchestratorLike, OrchestratorState } from "../types";
import type { AgentDispatcher } from "./remote/agent-dispatcher";
import type {
  StateDeltaMessage,
  StateRequestMessage,
  StateSnapshotMessage
} from "./remote/protocol";
import { ServerScheduler } from "./server-scheduler";
import type { ServerStateStore } from "./server-state-store";

const log = getLogger("orchestrator");

export class ServerCoordinator
  extends EventEmitter
  implements OrchestratorLike
{
  private dispatcher: AgentDispatcher;
  private store: ServerStateStore;
  private scheduler: ServerScheduler;
  private dispatcherHandlers: Array<{
    event: string;
    handler: (...args: unknown[]) => void;
  }> = [];
  private storeHandlers: Array<{ event: "stateChanged"; handler: () => void }> =
    [];

  constructor(
    dispatcher: AgentDispatcher,
    store: ServerStateStore,
    options: {
      maxConcurrentAgents: number;
      retryBackoff: {
        initialMs: number;
        maxMs: number;
        maxAttempts: number;
      };
    }
  ) {
    super();
    this.dispatcher = dispatcher;
    this.store = store;
    this.scheduler = new ServerScheduler(store, dispatcher, options);
  }

  getState(): OrchestratorState {
    return this.store.getState();
  }

  async getActiveAgents(): Promise<unknown[]> {
    return this.dispatcher.getAgents();
  }

  start(): void {
    const onStateChanged = () => {
      this.emit("stateChanged");
    };
    this.store.on("stateChanged", onStateChanged);
    this.storeHandlers.push({
      event: "stateChanged",
      handler: onStateChanged
    });

    const onAgentConnected = (agent: {
      agentId: string;
      clientId: string;
      projectName?: string;
    }) => {
      log.info(`Agent connected: ${agent.agentId}`);
      this.requestSnapshot(agent.agentId, agent.projectName ?? "default");
      this.emit("agentConnected", agent);
    };
    this.dispatcher.on("agentConnected", onAgentConnected);
    this.dispatcherHandlers.push({
      event: "agentConnected",
      handler: onAgentConnected as (...args: unknown[]) => void
    });

    const onAgentDisconnected = (data: {
      agentId: string;
      reason?: string;
    }) => {
      this.emit("agentDisconnected", data);
    };
    this.dispatcher.on("agentDisconnected", onAgentDisconnected);
    this.dispatcherHandlers.push({
      event: "agentDisconnected",
      handler: onAgentDisconnected as (...args: unknown[]) => void
    });

    const onStatusUpdate = (data: {
      agentId: string;
      taskFolder: string;
      subtaskFile?: string;
      status: string;
      timestamp: number;
    }) => {
      this.emit("agentStatusUpdate", data);
    };
    this.dispatcher.on("statusUpdate", onStatusUpdate);
    this.dispatcherHandlers.push({
      event: "statusUpdate",
      handler: onStatusUpdate as (...args: unknown[]) => void
    });

    const onSnapshot = (message: StateSnapshotMessage) => {
      this.store.applySnapshot(message.projectName, message.state);
    };
    this.dispatcher.on("stateSnapshot", onSnapshot);
    this.dispatcherHandlers.push({
      event: "stateSnapshot",
      handler: onSnapshot as (...args: unknown[]) => void
    });

    const onDelta = (message: StateDeltaMessage) => {
      this.store.applyDelta(message.projectName, message.updates);
    };
    this.dispatcher.on("stateDelta", onDelta);
    this.dispatcherHandlers.push({
      event: "stateDelta",
      handler: onDelta as (...args: unknown[]) => void
    });

    this.scheduler.on("jobCompleted", (data) =>
      this.emit("workerJobCompleted", data)
    );
    this.scheduler.on("jobFailed", (data) =>
      this.emit("workerJobFailed", data)
    );
    this.scheduler.on("jobRetrying", (data) =>
      this.emit("workerJobRetrying", data)
    );

    this.scheduler.start();
  }

  stop(): void {
    for (const { event, handler } of this.dispatcherHandlers) {
      this.dispatcher.off(event, handler);
    }
    for (const { event, handler } of this.storeHandlers) {
      this.store.off(event, handler);
    }
    this.dispatcherHandlers = [];
    this.storeHandlers = [];
    this.scheduler.stop();
  }

  private requestSnapshot(agentId: string, projectName: string): void {
    const message: StateRequestMessage = {
      type: "state:request",
      projectName
    };
    this.dispatcher.sendToAgent(agentId, message);
  }
}
