import { EventEmitter } from "node:events";
import { join } from "node:path";
import { getLogger } from "@aop/infra";
import {
  createParserState,
  flushBuffer,
  processChunk,
  type StreamParserState,
} from "./stream-parser";
import type {
  AskUserQuestionInput,
  ClaudeSessionEvents,
  Question,
  QuestionOption,
  SessionOptions,
  StreamEvent,
} from "./types";

const logger = getLogger("claude-session");
const DEFAULT_SETTING_SOURCES = "user,project";

export class ClaudeCodeSession {
  private emitter = new EventEmitter();
  private _sessionId: string | null = null;
  private _isRunning = false;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private options: SessionOptions;
  private lastOutput = "";

  constructor(options: SessionOptions = {}) {
    this.options = options;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  on<K extends keyof ClaudeSessionEvents>(
    event: K,
    listener: (...args: ClaudeSessionEvents[K]) => void,
  ): this {
    this.emitter.on(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof ClaudeSessionEvents>(
    event: K,
    listener: (...args: ClaudeSessionEvents[K]) => void,
  ): this {
    this.emitter.off(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof ClaudeSessionEvents>(
    event: K,
    listener: (...args: ClaudeSessionEvents[K]) => void,
  ): this {
    this.emitter.once(event as string, listener as (...args: unknown[]) => void);
    return this;
  }

  removeAllListeners<K extends keyof ClaudeSessionEvents>(event?: K): this {
    this.emitter.removeAllListeners(event as string | undefined);
    return this;
  }

  async run(prompt: string): Promise<void> {
    if (this._isRunning) {
      throw new Error("Session is already running");
    }

    const cmd = this.buildCommand(prompt);
    logger.debug("Starting session with command: {cmd}", { cmd: cmd.join(" ") });

    await this.spawnAndProcess(cmd);
  }

  async resume(sessionId: string, answer: string): Promise<void> {
    if (this._isRunning) {
      throw new Error("Session is already running");
    }

    this._sessionId = sessionId;
    const cmd = this.buildResumeCommand(sessionId, answer);
    logger.debug("Resuming session {sessionId}", { sessionId, cmd: cmd.join(" ") });

    await this.spawnAndProcess(cmd);
  }

  kill(): void {
    if (this.proc && this._isRunning) {
      logger.debug("Killing session {sessionId}", { sessionId: this._sessionId });
      this.proc.kill();
    }
  }

  private buildCommand(prompt: string): string[] {
    const settingSources = this.options.settingSources ?? DEFAULT_SETTING_SOURCES;
    const cmd = [
      "claude",
      "--output-format",
      "stream-json",
      "--print",
      "--verbose",
      "--setting-sources",
      settingSources,
      "--disallowed-tools",
      "AskUserQuestion",
    ];
    if (this.options.dangerouslySkipPermissions) {
      cmd.push("--dangerously-skip-permissions");
    }
    cmd.push(prompt);
    return cmd;
  }

  private buildResumeCommand(sessionId: string, answer: string): string[] {
    const settingSources = this.options.settingSources ?? DEFAULT_SETTING_SOURCES;
    const cmd = [
      "claude",
      "--output-format",
      "stream-json",
      "--print",
      "--verbose",
      "--setting-sources",
      settingSources,
      "--disallowed-tools",
      "AskUserQuestion",
      "--resume",
      sessionId,
    ];
    if (this.options.dangerouslySkipPermissions) {
      cmd.push("--dangerously-skip-permissions");
    }
    cmd.push(answer);
    return cmd;
  }

  private buildEnvWithNodeModulesBin(): Record<string, string> {
    const cwd = this.options.cwd || process.cwd();
    const nodeModulesBin = join(cwd, "node_modules", ".bin");
    const currentPath = process.env.PATH || "";
    return {
      ...process.env,
      PATH: `${nodeModulesBin}:${currentPath}`,
    } as Record<string, string>;
  }

  private async spawnAndProcess(cmd: string[]): Promise<void> {
    this._isRunning = true;
    this.lastOutput = "";

    this.proc = Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      cwd: this.options.cwd,
      env: this.buildEnvWithNodeModulesBin(),
    });

    const state = createParserState();
    const killedForQuestion = await this.readStream(state);
    const exitCode = await this.proc.exited;
    this._isRunning = false;
    this.proc = null;

    this.emitFinalEvent(killedForQuestion, exitCode);
  }

  private async readStream(state: StreamParserState): Promise<boolean> {
    if (!this.proc) return false;

    const stdout = this.proc.stdout;
    if (typeof stdout === "number" || !stdout) return false;

    try {
      const killedForQuestion = await this.consumeStream(stdout, state);
      this.flushRemainingEvents(killedForQuestion, state);
      return killedForQuestion;
    } catch (err) {
      logger.error("Error processing stream: {error}", { error: String(err) });
      return false;
    }
  }

  private async consumeStream(
    stdout: ReadableStream<Uint8Array>,
    state: StreamParserState,
  ): Promise<boolean> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const result = this.processStreamChunk(chunk, state);
      if (result.killedForQuestion) return true;
    }

    return false;
  }

  private flushRemainingEvents(killedForQuestion: boolean, state: StreamParserState): void {
    if (killedForQuestion) return;

    const remaining = flushBuffer(state);
    for (const event of remaining) {
      this.handleEvent(event);
    }
  }

  private processStreamChunk(
    chunk: string,
    state: StreamParserState,
  ): { killedForQuestion: boolean } {
    const { events, sessionId } = processChunk(chunk, state);

    if (sessionId && !this._sessionId) {
      this._sessionId = sessionId;
    }

    for (const event of events) {
      const killedForQuestion = this.handleEvent(event);
      if (killedForQuestion) {
        return { killedForQuestion: true };
      }
    }

    return { killedForQuestion: false };
  }

  private emitFinalEvent(killedForQuestion: boolean, exitCode: number): void {
    if (killedForQuestion) return;

    if (exitCode === 0) {
      this.emitter.emit("completed", this.lastOutput);
    } else {
      this.emitter.emit("error", exitCode);
    }
  }

  private handleEvent(event: StreamEvent): boolean {
    switch (event.type) {
      case "assistant":
        this.lastOutput = event.message.content;
        this.emitter.emit("message", event.message.content);
        return false;

      case "tool_use":
        return this.handleToolUse(event.tool_use.name, event.tool_use.input);

      case "result":
        if (event.result) {
          this.lastOutput = event.result;
        }
        return false;

      default:
        return false;
    }
  }

  private handleToolUse(name: string, input: unknown): boolean {
    this.emitter.emit("toolUse", name, input);

    if (name === "AskUserQuestion") {
      const questionInput = parseAskUserQuestionInput(input);
      if (questionInput) {
        logger.debug("Received AskUserQuestion with {count} questions", {
          count: questionInput.questions.length,
        });
        this.emitter.emit("question", questionInput);
        this.kill();
        return true;
      }
      logger.warn("Failed to parse AskUserQuestion input");
    }
    return false;
  }
}

const parseAskUserQuestionInput = (input: unknown): AskUserQuestionInput | null => {
  if (!input || typeof input !== "object") return null;

  const data = input as Record<string, unknown>;
  const questions = data.questions;
  if (!Array.isArray(questions)) return null;

  const parsedQuestions = questions.map(parseQuestion).filter((q): q is Question => q !== null);
  return parsedQuestions.length > 0 ? { questions: parsedQuestions } : null;
};

const parseQuestion = (q: unknown): Question | null => {
  if (!q || typeof q !== "object") return null;
  const qData = q as Record<string, unknown>;

  if (typeof qData.question !== "string") return null;

  return {
    question: qData.question,
    header: typeof qData.header === "string" ? qData.header : undefined,
    options: parseOptions(qData.options),
    multiSelect: typeof qData.multiSelect === "boolean" ? qData.multiSelect : undefined,
  };
};

const parseOptions = (options: unknown): QuestionOption[] | undefined => {
  if (!Array.isArray(options)) return undefined;

  const parsed = options.map(parseOption).filter((o): o is QuestionOption => o !== null);
  return parsed.length > 0 ? parsed : undefined;
};

const parseOption = (o: unknown): QuestionOption | null => {
  if (!o || typeof o !== "object") return null;
  const opt = o as Record<string, unknown>;
  if (typeof opt.label !== "string") return null;

  return {
    label: opt.label,
    description: typeof opt.description === "string" ? opt.description : undefined,
  };
};
