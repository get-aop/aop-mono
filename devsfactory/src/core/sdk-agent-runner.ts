import { EventEmitter } from "node:events";
import { mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionResult,
  codingTools,
  createAgentSession,
  discoverAuthStorage,
  discoverModels,
  discoverSkills
} from "@mariozechner/pi-coding-agent";
import KSUID from "ksuid";
import { getLogger } from "../infra/logger";
import type { AgentProcess, AgentType } from "../types";

const log = getLogger("sdk-agent-runner");

export interface SdkSpawnOptions {
  type: AgentType;
  taskFolder: string;
  subtaskFile?: string;
  prompt: string;
  cwd: string;
  taskDir?: string;
  projectRoot?: string;
  extraArgs?: string[];
  logsDir?: string;
}

interface RunningSession {
  agentProcess: AgentProcess;
  session: AgentSession;
  abortController: AbortController;
  logFile?: Awaited<ReturnType<typeof open>>;
}

const loadAuthToken = async (): Promise<string | null> => {
  if (process.env.ANTHROPIC_OAUTH_TOKEN) {
    return process.env.ANTHROPIC_OAUTH_TOKEN;
  }

  const authFile = join(homedir(), ".claude-agi", "auth.json");
  try {
    const file = Bun.file(authFile);
    if (!(await file.exists())) {
      return null;
    }
    const data = await file.json();
    const token = data.apiKey;

    if (token) {
      process.env.ANTHROPIC_OAUTH_TOKEN = token;
      return token;
    }
    return null;
  } catch {
    return null;
  }
};

export class SdkAgentRunner extends EventEmitter {
  private sessions: Map<string, RunningSession> = new Map();

  async spawn(options: SdkSpawnOptions): Promise<AgentProcess> {
    const id = this.generateId();
    const startedAt = new Date();

    log.info(
      `Spawning agent ${id} for ${options.taskFolder}/${options.subtaskFile ?? "task"}`
    );
    log.info(`Working directory: ${options.cwd}`);

    const token = await loadAuthToken();
    if (!token) {
      log.error("No auth token available");
      throw new Error(
        "Not authenticated. Run `aop auth` to set up authentication."
      );
    }
    log.info(`Auth token loaded: ${token.slice(0, 15)}...`);

    const authStorage = discoverAuthStorage();
    const modelRegistry = discoverModels(authStorage);

    const allModels = modelRegistry.getAll();
    log.info(`Total models in registry: ${allModels.length}`);

    const availableModels = modelRegistry.getAvailable();
    log.info(`Available models with auth: ${availableModels.length}`);
    if (availableModels.length > 0) {
      log.info(
        `Available models: ${availableModels.map((m) => `${m.provider}/${m.id}`).join(", ")}`
      );
    }

    if (availableModels.length === 0) {
      log.error("No models available. Checking auth for anthropic provider...");
      const anthropicKey = await authStorage.getApiKey("anthropic");
      log.error(
        `Anthropic API key from authStorage: ${anthropicKey ? `${anthropicKey.slice(0, 15)}...` : "NOT FOUND"}`
      );
      log.error(
        `ANTHROPIC_OAUTH_TOKEN env: ${process.env.ANTHROPIC_OAUTH_TOKEN ? "SET" : "NOT SET"}`
      );
      log.error(
        `ANTHROPIC_API_KEY env: ${process.env.ANTHROPIC_API_KEY ? "SET" : "NOT SET"}`
      );
      throw new Error("No models available. Check authentication.");
    }

    // Only use Opus 4.5 model (most reliable with OAuth tokens)
    // IMPORTANT: Iterate through preferred models in ORDER to find the first available one
    const preferredOpusModels = ["claude-opus-4-5-20251101", "claude-opus-4-5"];

    let model: (typeof availableModels)[number] | undefined;
    for (const preferredId of preferredOpusModels) {
      model = availableModels.find(
        (m) => m.provider === "anthropic" && m.id === preferredId
      );
      if (model) {
        log.info(`Found preferred model: ${model.provider}/${model.id}`);
        break;
      }
    }

    if (!model) {
      log.error(
        "No Claude Opus 4.5 model available. Available Anthropic models:"
      );
      for (const m of availableModels.filter(
        (m) => m.provider === "anthropic"
      )) {
        log.error(`  - ${m.id}`);
      }
      throw new Error(
        "No Claude Opus 4.5 model available. Check your subscription."
      );
    }

    log.info(`Selected Opus model: ${model.provider}/${model.id}`);

    const { skills } = discoverSkills(options.cwd);
    log.debug(`Discovered ${skills.length} skills`);

    log.info(`Creating agent session with model ${model.provider}/${model.id}`);
    log.info(
      `Model details: api=${model.api}, contextWindow=${model.contextWindow}`
    );

    const { session }: CreateAgentSessionResult = await createAgentSession({
      cwd: options.cwd,
      authStorage,
      modelRegistry,
      model,
      skills,
      tools: codingTools
    });
    log.info("Agent session created successfully");
    log.info(`Session model: ${session.model?.provider}/${session.model?.id}`);

    const agentProcess: AgentProcess = {
      id,
      type: options.type,
      taskFolder: options.taskFolder,
      subtaskFile: options.subtaskFile,
      pid: 0, // SDK sessions don't have OS process IDs
      startedAt
    };

    let logFile: Awaited<ReturnType<typeof open>> | undefined;
    if (options.logsDir) {
      const logPath = join(options.logsDir, `${id}.log`);
      await mkdir(dirname(logPath), { recursive: true });
      logFile = await open(logPath, "a");
    }

    const abortController = new AbortController();

    this.sessions.set(id, {
      agentProcess,
      session,
      abortController,
      logFile
    });
    this.emit("started", { agentId: id, process: agentProcess });

    this.runSession(id, session, options.prompt, logFile);

    return agentProcess;
  }

  async kill(agentId: string): Promise<void> {
    const running = this.sessions.get(agentId);
    if (!running) return;

    running.abortController.abort();

    try {
      await running.session.abort();
    } catch {
      // Ignore abort errors
    }

    if (running.logFile) {
      await running.logFile.close();
    }

    this.sessions.delete(agentId);
  }

  getActive(): AgentProcess[] {
    return Array.from(this.sessions.values()).map((s) => s.agentProcess);
  }

  getCountByType(type: AgentType): number {
    return this.getActive().filter((p) => p.type === type).length;
  }

  private generateId(): string {
    return `agent-${KSUID.randomSync().string}`;
  }

  private runSession(
    agentId: string,
    session: AgentSession,
    prompt: string,
    logFile?: Awaited<ReturnType<typeof open>>
  ): void {
    const encoder = new TextEncoder();

    const writeLog = async (line: string) => {
      this.emit("output", { agentId, line });
      if (logFile) {
        await logFile.write(encoder.encode(`${line}\n`));
      }
    };

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.handleAgentEvent(agentId, event, writeLog);
    });

    log.info(`Sending prompt to agent ${agentId}`);
    log.info(`Prompt length: ${prompt.length} chars`);
    log.debug(`Prompt preview: ${prompt.slice(0, 200)}...`);

    const promptStartTime = Date.now();
    session
      .prompt(prompt)
      .then(() => {
        const promptDuration = Date.now() - promptStartTime;
        log.info(
          `Prompt completed for ${agentId} in ${promptDuration}ms, waiting for completion`
        );
        log.info(`Session isStreaming: ${session.isStreaming}`);
        return this.waitForCompletion(session);
      })
      .then(() => {
        // Check if the agent had an error (session.prompt() doesn't throw on API errors)
        const agentError = session.state.error;
        log.info(`Agent ${agentId} state.error: ${agentError || "none"}`);

        if (agentError) {
          log.error(`Agent ${agentId} API error: ${agentError}`);
          writeLog(`[API Error] ${agentError}`);
          this.emit("error", { agentId, error: new Error(agentError) });
          this.handleSessionComplete(agentId, 1, unsubscribe, logFile);
          return;
        }

        // Check if any actual work was done (at least one assistant message)
        const messages = session.state.messages;
        log.info(`Agent ${agentId} total messages: ${messages.length}`);

        // Log message summary
        const messageSummary = messages
          .map((m) => {
            const msg = m as {
              role: string;
              stopReason?: string;
              errorMessage?: string;
            };
            return `${msg.role}${msg.stopReason ? `(${msg.stopReason})` : ""}`;
          })
          .join(", ");
        log.info(`Agent ${agentId} messages: [${messageSummary}]`);

        const hasAssistantResponse = messages.some(
          (m) => m.role === "assistant" && m.content && m.content.length > 0
        );
        if (!hasAssistantResponse) {
          const noWorkError = "Agent completed without producing any response";
          log.error(`Agent ${agentId}: ${noWorkError}`);
          writeLog(`[Error] ${noWorkError}`);
          this.emit("error", { agentId, error: new Error(noWorkError) });
          this.handleSessionComplete(agentId, 1, unsubscribe, logFile);
          return;
        }

        // Check for error in last assistant message
        const lastAssistant = messages
          .filter((m) => m.role === "assistant")
          .pop() as
          | {
              stopReason?: string;
              errorMessage?: string;
            }
          | undefined;
        if (lastAssistant?.stopReason === "error") {
          log.error(
            `Agent ${agentId} last message was error: ${lastAssistant.errorMessage}`
          );
          writeLog(`[Last Message Error] ${lastAssistant.errorMessage}`);
          this.emit("error", {
            agentId,
            error: new Error(lastAssistant.errorMessage || "Unknown error")
          });
          this.handleSessionComplete(agentId, 1, unsubscribe, logFile);
          return;
        }

        log.info(
          `Agent ${agentId} completed successfully with ${messages.length} messages`
        );
        this.handleSessionComplete(agentId, 0, unsubscribe, logFile);
      })
      .catch((error) => {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error(`Agent ${agentId} error: ${errorMsg}`);
        writeLog(`[Error] ${errorMsg}`);
        this.emit("error", { agentId, error });
        this.handleSessionComplete(agentId, 1, unsubscribe, logFile);
      });
  }

  private handleAgentEvent(
    agentId: string,
    event: AgentSessionEvent,
    writeLog: (line: string) => Promise<void>
  ): void {
    const shortId = agentId.slice(-8);

    switch (event.type) {
      case "message_start":
        if ("message" in event && event.message) {
          log.info(`[${shortId}] Message started: role=${event.message.role}`);
        }
        break;

      case "message_update":
        if ("assistantMessageEvent" in event && event.assistantMessageEvent) {
          const assistantEvent = event.assistantMessageEvent;
          if (assistantEvent.type === "text_delta" && assistantEvent.delta) {
            writeLog(assistantEvent.delta);
          } else if (assistantEvent.type === "toolcall_start") {
            const toolUse = assistantEvent as { toolName?: string };
            if (toolUse.toolName) {
              log.info(`[${shortId}] Tool call: ${toolUse.toolName}`);
            }
          }
        }
        break;

      case "message_end":
        if ("message" in event && event.message) {
          const msg = event.message as {
            role: string;
            stopReason?: string;
            errorMessage?: string;
          };
          log.info(
            `[${shortId}] Message ended: role=${msg.role}, stopReason=${msg.stopReason || "none"}`
          );
          if (msg.stopReason === "error" && msg.errorMessage) {
            log.error(`[${shortId}] Message error: ${msg.errorMessage}`);
            writeLog(`[Message Error] ${msg.errorMessage}`);
          }
        }
        break;

      case "tool_execution_start":
        log.info(`[${shortId}] Executing: ${event.toolName}`);
        writeLog(`[Tool: ${event.toolName}] Starting...`);
        break;

      case "tool_execution_end":
        if (event.isError) {
          const errorMsg =
            typeof event.result === "object"
              ? JSON.stringify(event.result)
              : event.result;
          log.error(`[${shortId}] Tool error: ${event.toolName} - ${errorMsg}`);
          writeLog(`[Tool: ${event.toolName}] Error: ${errorMsg}`);
        } else {
          log.info(`[${shortId}] Completed: ${event.toolName}`);
          writeLog(`[Tool: ${event.toolName}] Done`);
        }
        break;

      case "turn_end":
        if ("message" in event && event.message) {
          const msg = event.message as { stopReason?: string };
          log.info(
            `[${shortId}] Turn ended: stopReason=${msg.stopReason || "none"}`
          );
        }
        break;

      case "agent_end":
        log.info(`[${shortId}] Agent session ended`);
        break;
    }
  }

  private async waitForCompletion(session: AgentSession): Promise<void> {
    while (session.isStreaming) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async handleSessionComplete(
    agentId: string,
    exitCode: number,
    unsubscribe: () => void,
    logFile?: Awaited<ReturnType<typeof open>>
  ): Promise<void> {
    unsubscribe();

    const running = this.sessions.get(agentId);
    if (running) {
      try {
        running.session.dispose();
      } catch {
        // Ignore dispose errors
      }
    }

    if (logFile) {
      await logFile.close();
    }

    this.sessions.delete(agentId);
    this.emit("completed", { agentId, exitCode });
  }
}
