import { EventEmitter } from "node:events";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import KSUID from "ksuid";
import { getLogger } from "../infra/logger";
import type { AgentProcess, AgentType } from "../types";
import {
  ClaudeCodeSession,
  type ClaudeCodeSessionResult,
  type ParsedStreamLine
} from "./claude-code-session";

const log = getLogger("claude-code-runner");

/**
 * Options for spawning an agent via Claude Code
 */
export interface ClaudeCodeSpawnOptions {
  type: AgentType;
  taskFolder: string;
  subtaskFile?: string;
  prompt: string;
  cwd: string;
  taskDir?: string;
  projectRoot?: string;
  extraArgs?: string[];
  logsDir?: string;
  model?: string;
  systemPrompt?: string;
  maxBudgetUsd?: number;
}

/**
 * Internal state for a running agent
 */
interface RunningAgent {
  agentProcess: AgentProcess;
  session: ClaudeCodeSession;
  internalSessionId: string;
  claudeSessionId?: string;
  logFile?: Awaited<ReturnType<typeof open>>;
  aborted: boolean;
}

/**
 * Events emitted by ClaudeCodeRunner
 */
export interface ClaudeCodeRunnerEvents {
  started: { agentId: string; process: AgentProcess };
  output: { agentId: string; line: string };
  toolUse: { agentId: string; toolName: string; input: unknown };
  error: { agentId: string; error: Error };
  completed: {
    agentId: string;
    exitCode: number;
    result?: ClaudeCodeSessionResult;
  };
}

/**
 * ClaudeCodeRunner spawns and manages Claude Code agents for the orchestrator.
 *
 * This replaces SdkAgentRunner by using Claude Code CLI in background mode
 * instead of the pi-coding-agent SDK.
 *
 * Key differences from SdkAgentRunner:
 * - Uses Claude Code subprocess instead of SDK sessions
 * - No OAuth token management needed (uses user's Claude Code credentials)
 * - Output streamed to log files
 * - Simpler lifecycle management
 */
export class ClaudeCodeRunner extends EventEmitter {
  private agents: Map<string, RunningAgent> = new Map();

  /**
   * Spawn a new Claude Code agent
   */
  async spawn(options: ClaudeCodeSpawnOptions): Promise<AgentProcess> {
    const id = this.generateId();
    const startedAt = new Date();

    log.info(
      `Spawning agent ${id} for ${options.taskFolder}/${options.subtaskFile ?? "task"}`
    );
    log.info(`Working directory: ${options.cwd}`);
    log.debug(`Prompt length: ${options.prompt.length} chars`);

    // Setup log file
    let logFile: Awaited<ReturnType<typeof open>> | undefined;
    if (options.logsDir) {
      const logPath = join(options.logsDir, `${id}.log`);
      await mkdir(dirname(logPath), { recursive: true });
      logFile = await open(logPath, "a");
      log.debug(`Log file: ${logPath}`);
    }

    const agentProcess: AgentProcess = {
      id,
      type: options.type,
      taskFolder: options.taskFolder,
      subtaskFile: options.subtaskFile,
      pid: 0, // We track via session, not OS process ID
      startedAt
    };

    const session = new ClaudeCodeSession();

    const runningAgent: RunningAgent = {
      agentProcess,
      session,
      internalSessionId: "",
      logFile,
      aborted: false
    };

    this.agents.set(id, runningAgent);
    this.emit("started", { agentId: id, process: agentProcess });

    // Run the agent asynchronously
    this.runAgent(id, session, options, logFile);

    return agentProcess;
  }

  /**
   * Kill a running agent
   */
  async kill(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      log.warn(`Agent ${agentId} not found for kill`);
      return;
    }

    log.info(`Killing agent ${agentId}`);
    agent.aborted = true;

    // Kill the session if we have an internal ID
    if (agent.internalSessionId) {
      await agent.session.kill(agent.internalSessionId);
    }

    if (agent.logFile) {
      await agent.logFile.close();
    }

    this.agents.delete(agentId);
  }

  /**
   * Get all active agent processes
   */
  getActive(): AgentProcess[] {
    return Array.from(this.agents.values()).map((a) => a.agentProcess);
  }

  /**
   * Get count of active agents by type
   */
  getCountByType(type: AgentType): number {
    return this.getActive().filter((p) => p.type === type).length;
  }

  private async runAgent(
    agentId: string,
    session: ClaudeCodeSession,
    options: ClaudeCodeSpawnOptions,
    logFile?: Awaited<ReturnType<typeof open>>
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const encoder = new TextEncoder();

    const writeLog = async (line: string): Promise<void> => {
      this.emit("output", { agentId, line });
      if (logFile) {
        await logFile.write(encoder.encode(`${line}\n`));
      }
    };

    // Subscribe to session events
    session.on("output", async ({ line, parsed }) => {
      if (agent.aborted) return;

      const formattedLine = this.formatOutputLine(parsed, line);
      if (formattedLine) {
        await writeLog(formattedLine);
      }
    });

    session.on("toolUse", ({ toolName, input }) => {
      if (agent.aborted) return;

      log.debug(`[${agentId.slice(-8)}] Tool: ${toolName}`);
      this.emit("toolUse", { agentId, toolName, input });
    });

    session.on("completed", ({ result }) => {
      if (result.sessionId) {
        agent.claudeSessionId = result.sessionId;
      }
    });

    try {
      log.info(`Running agent ${agentId}`);

      const result = await session.run({
        cwd: options.cwd,
        prompt: options.prompt,
        model: options.model ?? "opus",
        systemPrompt: options.systemPrompt,
        dangerouslySkipPermissions: true,
        maxBudgetUsd: options.maxBudgetUsd,
        outputFormat: "stream-json",
        verbose: true
      });

      // Store session ID for potential recovery
      if (result.sessionId) {
        agent.claudeSessionId = result.sessionId;
      }

      if (agent.aborted) {
        log.info(`Agent ${agentId} was aborted`);
        return;
      }

      // Check result status
      if (result.status === "error") {
        const errorMsg = result.error ?? "Unknown error";
        log.error(`Agent ${agentId} error: ${errorMsg}`);
        await writeLog(`[Error] ${errorMsg}`);
        this.emit("error", { agentId, error: new Error(errorMsg) });
        await this.handleAgentComplete(agentId, 1, result);
        return;
      }

      if (result.status === "waiting_for_input") {
        // Agents shouldn't need user input - log warning
        log.warn(`Agent ${agentId} waiting for input (unexpected)`);
        await writeLog("[Warning] Agent waiting for user input");
        // Treat as error - agents should be autonomous
        this.emit("error", {
          agentId,
          error: new Error("Agent unexpectedly requested user input")
        });
        await this.handleAgentComplete(agentId, 1, result);
        return;
      }

      // Success
      log.info(`Agent ${agentId} completed successfully`);
      if (result.usage) {
        log.info(
          `Agent ${agentId} usage: ${result.usage.inputTokens} in, ${result.usage.outputTokens} out, $${result.usage.totalCostUsd.toFixed(4)}`
        );
      }
      await this.handleAgentComplete(agentId, 0, result);
    } catch (error) {
      if (agent.aborted) {
        log.info(`Agent ${agentId} was aborted`);
        return;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`Agent ${agentId} error: ${errorMsg}`);
      await writeLog(`[Error] ${errorMsg}`);
      this.emit("error", {
        agentId,
        error: error instanceof Error ? error : new Error(errorMsg)
      });
      await this.handleAgentComplete(agentId, 1);
    }
  }

  private formatOutputLine(
    parsed: ParsedStreamLine | null,
    rawLine: string
  ): string | null {
    if (!parsed) {
      // Not JSON, return raw if non-empty
      return rawLine.trim() || null;
    }

    switch (parsed.type) {
      case "system":
        // Skip system init messages
        return null;

      case "assistant": {
        const parts: string[] = [];
        for (const item of parsed.content) {
          if (item.type === "text" && item.text) {
            parts.push(item.text);
          } else if (item.type === "tool_use" && item.name) {
            // Format tool use compactly
            const input = item.input as Record<string, unknown> | undefined;
            if (item.name === "Read" && input?.file_path) {
              const path = String(input.file_path)
                .split("/")
                .slice(-2)
                .join("/");
              parts.push(`[Read: ${path}]`);
            } else if (item.name === "Write" && input?.file_path) {
              const path = String(input.file_path)
                .split("/")
                .slice(-2)
                .join("/");
              parts.push(`[Write: ${path}]`);
            } else if (item.name === "Edit" && input?.file_path) {
              const path = String(input.file_path)
                .split("/")
                .slice(-2)
                .join("/");
              parts.push(`[Edit: ${path}]`);
            } else if (item.name === "Bash" && input?.command) {
              const cmd = String(input.command).slice(0, 60);
              parts.push(`[Bash: ${cmd}${cmd.length >= 60 ? "..." : ""}]`);
            } else if (
              (item.name === "Glob" || item.name === "Grep") &&
              input?.pattern
            ) {
              const pattern = String(input.pattern).slice(0, 40);
              parts.push(`[${item.name}: ${pattern}]`);
            } else {
              parts.push(`[${item.name}]`);
            }
          }
        }
        return parts.length > 0 ? parts.join(" ") : null;
      }

      case "user":
        // Skip user messages (tool results) - too verbose
        return null;

      case "result": {
        const cost = parsed.usage?.totalCostUsd
          ? ` ($${parsed.usage.totalCostUsd.toFixed(4)})`
          : "";
        return `── Result: ${parsed.subtype}${cost}`;
      }

      default:
        return null;
    }
  }

  private async handleAgentComplete(
    agentId: string,
    exitCode: number,
    result?: ClaudeCodeSessionResult
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    if (agent.logFile) {
      await agent.logFile.close();
    }

    this.agents.delete(agentId);
    this.emit("completed", { agentId, exitCode, result });
  }

  private generateId(): string {
    return `agent-${KSUID.randomSync().string}`;
  }
}
