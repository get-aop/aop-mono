import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import KSUID from "ksuid";
import { getLogger } from "../infra/logger";

const log = getLogger("claude-code-session");

/**
 * Resolve the path to the claude binary.
 * Checks common installation locations.
 */
const resolveClaudeBinary = async (): Promise<string> => {
  // Check common installation locations first for predictable behavior
  const locations = [
    join(homedir(), ".local", "bin", "claude"),
    join(homedir(), ".claude", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude"
  ];

  for (const loc of locations) {
    if (await Bun.file(loc).exists()) {
      log.debug(`Found claude binary at: ${loc}`);
      return loc;
    }
  }

  // Fall back to 'claude' if we can find it via which
  const whichResult = Bun.spawnSync(["which", "claude"]);
  if (whichResult.exitCode === 0) {
    const path = new TextDecoder().decode(whichResult.stdout).trim();
    if (path) {
      log.debug(`Found claude via which: ${path}`);
      return path;
    }
  }

  // Last resort - try 'claude' directly and let it fail with a clear error
  log.warn("Could not resolve claude binary path, using 'claude' directly");
  return "claude";
};

// Cache the resolved path
let claudeBinaryPath: string | null = null;

/**
 * Represents a question from Claude's AskUserQuestion tool
 */
export interface ClaudeCodeQuestion {
  toolUseId: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
}

/**
 * Token usage information from a Claude Code session
 */
export interface ClaudeCodeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
}

/**
 * Result from a Claude Code session execution
 */
export interface ClaudeCodeSessionResult {
  status: "completed" | "waiting_for_input" | "error";
  sessionId: string;
  output: string;
  question?: ClaudeCodeQuestion;
  usage?: ClaudeCodeUsage;
  error?: string;
  exitCode?: number;
}

/**
 * Options for starting a new Claude Code session
 */
export interface ClaudeCodeSessionOptions {
  cwd: string;
  prompt: string;
  resume?: string;
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  /**
   * @deprecated Always enabled internally for kill/resume pattern.
   * This option is kept for backwards compatibility but has no effect.
   */
  dangerouslySkipPermissions?: boolean;
  outputFormat?: "json" | "stream-json";
  verbose?: boolean;
}

/**
 * Stream event from Claude Code's JSON output
 */
export interface StreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: unknown;
      id?: string;
    }>;
  };
}

/**
 * Internal state for tracking a running session
 */
interface SessionState {
  sessionId?: string;
  events: StreamEvent[];
  question?: ClaudeCodeQuestion;
  outputText: string;
  usage?: ClaudeCodeUsage;
  isError?: boolean;
  errorMessage?: string;
}

/**
 * Events emitted by ClaudeCodeSession
 */
export interface ClaudeCodeSessionEvents {
  output: { sessionId: string; line: string; parsed: ParsedStreamLine | null };
  toolUse: { sessionId: string; toolName: string; input: unknown };
  question: { sessionId: string; question: ClaudeCodeQuestion };
  completed: { sessionId: string; result: ClaudeCodeSessionResult };
  error: { sessionId: string; error: Error };
}

/**
 * Convert a raw StreamEvent to the ParsedStreamLine format expected by consumers
 */
const toParsedStreamLine = (event: StreamEvent): ParsedStreamLine | null => {
  if (event.type === "system") {
    return {
      type: "system",
      subtype: event.subtype ?? "",
      sessionId: event.session_id ?? "",
      tools: []
    };
  }

  if (event.type === "assistant" && event.message?.content) {
    return {
      type: "assistant",
      content: event.message.content.map((item) => ({
        type: item.type as "text" | "tool_use",
        text: item.text,
        name: item.name,
        input: item.input,
        id: item.id
      }))
    };
  }

  if (event.type === "user") {
    return {
      type: "user",
      content: event.message?.content
    };
  }

  if (event.type === "result") {
    return {
      type: "result",
      subtype: event.subtype ?? "",
      sessionId: event.session_id ?? "",
      isError: event.is_error ?? false,
      result: event.result ?? "",
      usage: {
        inputTokens: event.usage?.input_tokens ?? 0,
        outputTokens: event.usage?.output_tokens ?? 0,
        cacheReadInputTokens: event.usage?.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: event.usage?.cache_creation_input_tokens ?? 0,
        totalCostUsd: event.total_cost_usd ?? 0
      }
    };
  }

  return null;
};

/**
 * Parsed stream line in the format expected by consumers.
 * This is a transformed version of StreamEvent with cleaner types.
 */
export type ParsedStreamLine =
  | { type: "system"; subtype: string; sessionId: string; tools: string[] }
  | {
      type: "assistant";
      content: Array<{
        type: "text" | "tool_use";
        text?: string;
        name?: string;
        input?: unknown;
        id?: string;
      }>;
    }
  | { type: "user"; content: unknown }
  | {
      type: "result";
      subtype: string;
      sessionId: string;
      isError: boolean;
      result: string;
      usage: ClaudeCodeUsage;
    };

const parseStreamLine = (line: string): StreamEvent | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
};

const isAskUserQuestion = (
  event: StreamEvent
): { toolUseId: string; questions: ClaudeCodeQuestion["questions"] } | null => {
  if (event.type !== "assistant") return null;

  const content = event.message?.content;
  if (!Array.isArray(content)) return null;

  const block = content.find(
    (c) => c.type === "tool_use" && c.name === "AskUserQuestion"
  );
  if (!block || !block.id) return null;

  const input = block.input as { questions?: ClaudeCodeQuestion["questions"] };
  if (!input?.questions) return null;

  return { toolUseId: block.id, questions: input.questions };
};

/**
 * ClaudeCodeSession manages Claude Code sessions with kill/resume pattern.
 *
 * Based on the working reference implementation, this uses:
 * - `stdin: "inherit"` for proper TTY handling
 * - `--dangerously-skip-permissions` to avoid permission denials
 * - Kill process immediately when AskUserQuestion is detected
 * - Resume with just the answer as the prompt
 */
export class ClaudeCodeSession extends EventEmitter {
  private internalId: string;
  private currentProc: ReturnType<typeof Bun.spawn> | null = null;
  private activeSessions: Set<string> = new Set();

  constructor() {
    super();
    this.internalId = `ccs-${KSUID.randomSync().string}`;
  }

  /**
   * Kill a running session
   * @deprecated In the new implementation, each run is independent.
   * This method will kill the current process if running.
   */
  async kill(_sessionId?: string): Promise<void> {
    if (this.currentProc) {
      log.info(`Killing current session process`);
      this.currentProc.kill();
      await this.currentProc.exited;
      this.currentProc = null;
    }
    this.activeSessions.clear();
  }

  /**
   * Get all active session IDs
   * @deprecated In the new implementation, sessions are not tracked.
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions);
  }

  /**
   * Start a new Claude Code session or resume an existing one
   */
  async run(
    options: ClaudeCodeSessionOptions
  ): Promise<ClaudeCodeSessionResult> {
    const isResume = !!options.resume;

    log.info(
      `${isResume ? "Resuming" : "Starting"} session ${this.internalId}${isResume ? ` (claude session: ${options.resume})` : ""}`
    );
    log.debug(`Working directory: ${options.cwd}`);
    if (isResume) {
      log.info(
        `Resume prompt (first 200 chars): ${options.prompt.slice(0, 200)}`
      );
    }

    try {
      const claudeBinary = await this.ensureClaudeBinary();
      const command = this.buildCommand(claudeBinary, options);
      log.debug(`Command: ${command.join(" ")}`);

      // Use stdin: "pipe" and close it immediately since we pass prompt via command line.
      // Using "inherit" can conflict with readline interfaces used for user input.
      const proc = Bun.spawn(command, {
        cwd: options.cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit"
      });

      // Close stdin immediately - we don't need it (prompt is via CLI arg)
      try {
        const stdin = proc.stdin as unknown;
        if (
          stdin &&
          typeof (stdin as { end?: () => void }).end === "function"
        ) {
          (stdin as { end: () => void }).end();
        }
      } catch {
        // Ignore stdin close errors
      }

      this.currentProc = proc;
      this.activeSessions.add(this.internalId);

      log.debug(`Subprocess spawned, pid: ${proc.pid}`);

      const state = await this.processStream(proc.stdout, proc);

      const exitCode = await proc.exited;
      this.currentProc = null;
      this.activeSessions.delete(this.internalId);
      log.info(`Session exited with code ${exitCode}`);

      return this.buildResult(state, exitCode);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error(`Session failed: ${errorMessage}`);
      return {
        status: "error",
        sessionId: "",
        output: "",
        error: errorMessage,
        exitCode: 1
      };
    }
  }

  private async ensureClaudeBinary(): Promise<string> {
    if (!claudeBinaryPath) {
      claudeBinaryPath = await resolveClaudeBinary();
      log.debug(`Resolved claude binary: ${claudeBinaryPath}`);
    }
    return claudeBinaryPath;
  }

  buildCommand(
    claudeBinary: string,
    options: ClaudeCodeSessionOptions
  ): string[] {
    const cmd = [claudeBinary];

    // Output format - always use stream-json for event processing
    cmd.push("--output-format", "stream-json");
    cmd.push("--verbose");

    // Required for non-interactive kill/resume pattern
    cmd.push("--dangerously-skip-permissions");

    // Resume existing session
    if (options.resume) {
      cmd.push("--resume", options.resume);
    }

    // Model selection
    if (options.model) {
      cmd.push("--model", options.model);
    }

    // System prompt
    if (options.systemPrompt) {
      cmd.push("--system-prompt", options.systemPrompt);
    }

    // Tool permissions
    if (options.allowedTools && options.allowedTools.length > 0) {
      cmd.push("--allowedTools", options.allowedTools.join(","));
    }

    if (options.disallowedTools && options.disallowedTools.length > 0) {
      cmd.push("--disallowedTools", options.disallowedTools.join(","));
    }

    // Limits
    if (options.maxTurns !== undefined) {
      cmd.push("--max-turns", String(options.maxTurns));
    }

    if (options.maxBudgetUsd !== undefined) {
      cmd.push("--max-budget-usd", String(options.maxBudgetUsd));
    }

    // Prompt as final argument
    cmd.push(options.prompt);

    return cmd;
  }

  private async processStream(
    stdout: ReadableStream<Uint8Array>,
    proc: ReturnType<typeof Bun.spawn>
  ): Promise<SessionState> {
    const state: SessionState = {
      events: [],
      outputText: ""
    };

    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let shouldStop = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseStreamLine(line);
        if (!event) continue;

        shouldStop = this.processEvent(event, line, state);
        if (shouldStop) {
          log.info("AskUserQuestion detected, killing process");
          proc.kill();
          reader.releaseLock();
          return state;
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      log.debug(`Processing remaining buffer: ${buffer.slice(0, 100)}...`);
      const event = parseStreamLine(buffer);
      if (event) {
        this.processEvent(event, buffer, state);
      }
    }

    log.info(
      `Stream ended. Total events: ${state.events.length}, has question: ${!!state.question}, sessionId: ${state.sessionId}`
    );

    // Debug: log all event types received
    const eventTypes = state.events.map((e) =>
      e.type === "assistant"
        ? `assistant(${e.message?.content?.map((c) => c.type).join(",")})`
        : e.type
    );
    log.info(`Event sequence: ${eventTypes.join(" -> ")}`);

    reader.releaseLock();
    return state;
  }

  private processEvent(
    event: StreamEvent,
    rawLine: string,
    state: SessionState
  ): boolean {
    state.events.push(event);
    const parsed = toParsedStreamLine(event);
    this.emit("output", { sessionId: this.internalId, line: rawLine, parsed });

    // Debug: log all events to understand the flow
    if (event.type === "assistant" && event.message?.content) {
      const contentTypes = event.message.content.map((c) =>
        c.type === "tool_use" ? `tool_use:${c.name}` : c.type
      );
      const textPreview = event.message.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text?.slice(0, 50))
        .join(" ");
      log.info(`Assistant: [${contentTypes.join(", ")}] "${textPreview}..."`);
    } else if (event.type === "result") {
      log.info(`Result: subtype=${event.subtype}, is_error=${event.is_error}`);
    } else {
      log.debug(`Event: type=${event.type}`);
    }

    // Track session ID
    if (event.session_id) {
      state.sessionId = event.session_id;
    }

    // Extract text from assistant messages
    if (event.type === "assistant" && event.message?.content) {
      for (const item of event.message.content) {
        if (item.type === "text" && item.text) {
          state.outputText += item.text;
        }
        if (item.type === "tool_use" && item.name) {
          this.emit("toolUse", {
            sessionId: this.internalId,
            toolName: item.name,
            input: item.input
          });
        }
      }
    }

    // Check for AskUserQuestion - return true to stop processing
    const questionInfo = isAskUserQuestion(event);
    if (questionInfo) {
      state.question = {
        toolUseId: questionInfo.toolUseId,
        questions: questionInfo.questions
      };
      this.emit("question", {
        sessionId: this.internalId,
        question: state.question
      });
      log.info(`Session has pending question`);
      return true; // Signal to stop and kill
    }

    // Track result for final status
    if (event.type === "result") {
      log.info(
        `Got result event: subtype=${event.subtype}, is_error=${event.is_error}, result_text=${event.result?.slice(0, 100)}`
      );
      log.info(
        `Session result: in=${event.usage?.input_tokens ?? 0}, out=${event.usage?.output_tokens ?? 0}, cost=$${event.total_cost_usd?.toFixed(4) ?? "0"}`
      );
      state.isError = event.is_error;
      if (event.is_error) {
        state.errorMessage = event.result;
      }
      if (event.usage || event.total_cost_usd !== undefined) {
        state.usage = {
          inputTokens: event.usage?.input_tokens ?? 0,
          outputTokens: event.usage?.output_tokens ?? 0,
          cacheReadInputTokens: event.usage?.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens:
            event.usage?.cache_creation_input_tokens ?? 0,
          totalCostUsd: event.total_cost_usd ?? 0
        };
      }
    }

    return false; // Continue processing
  }

  private buildResult(
    state: SessionState,
    exitCode: number
  ): ClaudeCodeSessionResult {
    let status: ClaudeCodeSessionResult["status"] = "completed";
    let error: string | undefined;

    if (state.question) {
      status = "waiting_for_input";
    } else if (state.isError) {
      status = "error";
      error = state.errorMessage;
    } else if (exitCode !== 0) {
      status = "error";
      error = `Process exited with code ${exitCode}`;
    }

    const result: ClaudeCodeSessionResult = {
      status,
      sessionId: state.sessionId ?? "",
      output: state.outputText,
      exitCode
    };

    if (state.question) {
      result.question = state.question;
    }

    if (error) {
      result.error = error;
    }

    if (state.usage) {
      result.usage = state.usage;
    }

    log.info(`Session result: status=${status}, sessionId=${state.sessionId}`);
    this.emit("completed", { sessionId: this.internalId, result });

    return result;
  }
}

/**
 * Helper function to run a single Claude Code session
 */
export async function runClaudeCodeSession(
  options: ClaudeCodeSessionOptions
): Promise<ClaudeCodeSessionResult> {
  const session = new ClaudeCodeSession();
  return session.run(options);
}

/**
 * Helper function to run and resume a session in a loop until completion.
 * Uses the kill/resume pattern for user interaction:
 * 1. Session runs until AskUserQuestion is detected
 * 2. Process is killed immediately (keeping session file clean)
 * 3. Resume with the user's answer as the prompt
 * 4. Claude interprets the prompt as the answer to the pending question
 */
export async function runInteractiveClaudeCodeSession(
  options: ClaudeCodeSessionOptions,
  onQuestion: (question: ClaudeCodeQuestion) => Promise<string>
): Promise<ClaudeCodeSessionResult> {
  const session = new ClaudeCodeSession();
  let result = await session.run(options);

  while (result.status === "waiting_for_input" && result.question) {
    log.info(`Session waiting for input, asking user...`);
    const answer = await onQuestion(result.question);

    log.info(`Resuming session ${result.sessionId} with user answer`);
    result = await session.run({
      ...options,
      resume: result.sessionId,
      prompt: answer
    });
  }

  return result;
}
