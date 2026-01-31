import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  type AgentSessionEvent,
  type CreateAgentSessionResult,
  codingTools,
  createAgentSession,
  discoverAuthStorage,
  discoverModels,
  discoverSkills,
  type AgentSession as PiAgentSession,
  type ToolDefinition
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { IOHandler } from "./interactive-io-handler";

// Load auth token from our storage and set as environment variable for pi-coding-agent
const loadAuthToken = async (): Promise<string | null> => {
  // First check if already set
  if (process.env.ANTHROPIC_OAUTH_TOKEN) {
    return process.env.ANTHROPIC_OAUTH_TOKEN;
  }

  // Load from our storage location
  const authFile = join(homedir(), ".claude-agi", "auth.json");
  try {
    const file = Bun.file(authFile);
    if (!(await file.exists())) {
      return null;
    }
    const data = await file.json();
    const token = data.apiKey;

    if (token) {
      // Set as ANTHROPIC_OAUTH_TOKEN for pi-ai to pick up
      process.env.ANTHROPIC_OAUTH_TOKEN = token;
      return token;
    }
    return null;
  } catch {
    return null;
  }
};

export interface InteractiveSessionOptions {
  cwd: string;
  ioHandler: IOHandler;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  debug?: boolean;
}

export interface InteractiveSessionResult {
  success: boolean;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  turns: number;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5-20251101": { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  "claude-opus-4-5": { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  "claude-sonnet-4-20250514": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  "claude-sonnet-4-5": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  "claude-3-5-sonnet-20241022": {
    input: 3 / 1_000_000,
    output: 15 / 1_000_000
  },
  "claude-3-opus-20240229": { input: 15 / 1_000_000, output: 75 / 1_000_000 }
};

const DEFAULT_MODEL = "claude-opus-4-5-20251101";
const MAX_TURNS_DEFAULT = 50;

const createAskUserQuestionTool = (ioHandler: IOHandler): ToolDefinition => ({
  name: "AskUserQuestion",
  label: "Ask User Question",
  description:
    "Ask the user a question and wait for their response. Use this when you need clarification, user preferences, or to offer choices.",
  parameters: Type.Object({
    questions: Type.Array(
      Type.Object({
        question: Type.String({ description: "The question to ask" }),
        header: Type.String({ description: "Short header/category" }),
        options: Type.Array(
          Type.Object({
            label: Type.String({ description: "Option label" }),
            description: Type.String({ description: "Option description" })
          })
        ),
        multiSelect: Type.Boolean({
          description: "Allow multiple selections",
          default: false
        })
      })
    )
  }),
  async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
    const typedParams = params as {
      questions: Array<{
        question: string;
        header: string;
        options: Array<{ label: string; description: string }>;
        multiSelect: boolean;
      }>;
    };
    const questions = typedParams.questions;

    const responses: string[] = [];

    for (const q of questions) {
      const response = await ioHandler.askUser(q.question, {
        choices: q.options,
        multiSelect: q.multiSelect,
        header: q.header
      });
      responses.push(response);
    }

    const responseText =
      responses.length === 1
        ? `User responded: ${responses[0]}`
        : `User responses:\n${responses.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;

    return {
      content: [{ type: "text", text: responseText }],
      details: { responses }
    };
  }
});

export class InteractiveSession extends EventEmitter {
  private options: Required<
    Omit<InteractiveSessionOptions, "systemPrompt"> & {
      systemPrompt: string | undefined;
    }
  >;
  private inputTokens = 0;
  private outputTokens = 0;
  private turns = 0;

  constructor(options: InteractiveSessionOptions) {
    super();
    this.options = {
      cwd: options.cwd,
      ioHandler: options.ioHandler,
      systemPrompt: options.systemPrompt,
      model: options.model ?? DEFAULT_MODEL,
      maxTurns: options.maxTurns ?? MAX_TURNS_DEFAULT,
      debug: options.debug ?? false
    };
  }

  async run(initialPrompt: string): Promise<InteractiveSessionResult> {
    try {
      if (this.options.debug) {
        console.log("[DEBUG] Starting run with pi-coding-agent SDK...");
        console.log("[DEBUG] Initial prompt length:", initialPrompt.length);
      }

      // Load auth token from our storage and set as environment variable
      const token = await loadAuthToken();
      if (!token) {
        throw new Error(
          "Not authenticated. Run `aop auth` to set up authentication."
        );
      }

      if (this.options.debug) {
        console.log(`[DEBUG] Auth token loaded: ${token.slice(0, 15)}...`);
      }

      // Use pi-coding-agent's auth infrastructure (it will now find the token via env var)
      const authStorage = discoverAuthStorage();
      const modelRegistry = discoverModels(authStorage);

      if (this.options.debug) {
        console.log("[DEBUG] Auth storage and model registry initialized");
        const availableModels = modelRegistry.getAvailable();
        console.log(
          "[DEBUG] Available models:",
          availableModels.map((m) => `${m.provider}/${m.id}`)
        );
      }

      // Find the requested model
      let model = modelRegistry
        .getAll()
        .find((m) => m.id === this.options.model);
      if (!model) {
        // Try finding by provider/id pattern
        model = modelRegistry
          .getAll()
          .find(
            (m) =>
              m.id.includes(this.options.model) ||
              this.options.model.includes(m.id)
          );
      }

      if (!model) {
        // Fall back to first available model
        const available = modelRegistry.getAvailable();
        if (available.length === 0) {
          throw new Error(
            "No models available. Run `pi login` to authenticate."
          );
        }
        model = available[0]!;
        if (this.options.debug) {
          console.log(
            "[DEBUG] Requested model not found, using:",
            model.provider,
            model.id
          );
        }
      }

      if (this.options.debug) {
        console.log("[DEBUG] Using model:", model!.provider, model!.id);
      }

      // Discover skills from ~/.claude/skills and project
      const { skills, warnings } = discoverSkills(this.options.cwd);
      if (this.options.debug) {
        console.log(
          "[DEBUG] Discovered skills:",
          skills.map((s) => s.name)
        );
        if (warnings.length > 0) {
          console.log("[DEBUG] Skill warnings:", warnings);
        }
      }

      // Create AskUserQuestion tool that uses our IOHandler
      const askUserTool = createAskUserQuestionTool(this.options.ioHandler);

      // Create the agent session using pi-coding-agent's SDK
      const { session }: CreateAgentSessionResult = await createAgentSession({
        cwd: this.options.cwd,
        authStorage,
        modelRegistry,
        model,
        skills,
        tools: codingTools,
        customTools: [askUserTool]
      });

      this.emit("started", { model: `${model!.provider}/${model!.id}` });

      // Subscribe to agent events
      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        this.handleAgentEvent(event);
      });

      try {
        // Send the initial prompt
        await session.prompt(initialPrompt);

        // Interactive loop: wait for streaming to stop, then prompt for input
        await this.runInteractiveLoop(session);
      } finally {
        unsubscribe();
        session.dispose();
      }

      const totalCostUsd = this.calculateCost();

      this.emit("complete", {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        totalCostUsd,
        turns: this.turns
      });

      return {
        success: true,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        totalCostUsd,
        turns: this.turns
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (this.options.debug) {
        console.log("[DEBUG] Error:", error);
        console.log("[DEBUG] Stack:", err instanceof Error ? err.stack : "N/A");
      }
      this.emit("error", { error });

      return {
        success: false,
        error,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        totalCostUsd: this.calculateCost(),
        turns: this.turns
      };
    }
  }

  private handleAgentEvent(event: AgentSessionEvent): void {
    if (this.options.debug) {
      console.log("[DEBUG] Agent event:", event.type);
    }

    switch (event.type) {
      case "turn_start":
        this.turns++;
        break;

      case "turn_end":
        // Track usage from the turn
        if ("message" in event && event.message) {
          const msg = event.message as AgentMessage & {
            usage?: { input?: number; output?: number };
          };
          if (msg.usage) {
            this.inputTokens += msg.usage.input ?? 0;
            this.outputTokens += msg.usage.output ?? 0;
          }
        }
        break;

      case "message_update":
        // Handle streaming text updates
        if ("assistantMessageEvent" in event && event.assistantMessageEvent) {
          const assistantEvent = event.assistantMessageEvent;
          // text_delta events contain the streaming text chunks
          if (assistantEvent.type === "text_delta" && assistantEvent.delta) {
            this.options.ioHandler.writeText(assistantEvent.delta);
          }
        }
        break;

      case "message_end":
        // Track usage
        if ("message" in event && event.message) {
          const msg = event.message as AgentMessage;
          if ("usage" in msg && msg.usage) {
            const usage = msg.usage as { input?: number; output?: number };
            this.inputTokens += usage.input ?? 0;
            this.outputTokens += usage.output ?? 0;
          }
        }
        break;

      case "tool_execution_start":
        this.options.ioHandler.writeToolUse(event.toolName, event.args);
        this.emit("toolUse", { name: event.toolName, input: event.args });
        if (this.options.debug) {
          console.log(
            "[DEBUG] Tool execution start:",
            event.toolName,
            event.args
          );
        }
        break;

      case "tool_execution_end":
        this.emit("toolResult", {
          name: event.toolName,
          success: !event.isError,
          output: event.result
        });
        if (this.options.debug) {
          console.log(
            "[DEBUG] Tool execution end:",
            event.toolName,
            "isError:",
            event.isError
          );
        }
        break;
    }
  }

  private async runInteractiveLoop(session: PiAgentSession): Promise<void> {
    while (this.turns < this.options.maxTurns) {
      // Wait for the agent to stop streaming
      await this.waitForStreamingToStop(session);

      if (this.options.debug) {
        console.log("[DEBUG] Streaming stopped, turns:", this.turns);
      }

      // Prompt user for input
      this.options.ioHandler.writeText("\n");
      const userInput = await this.options.ioHandler.askUser("");

      // Check for exit commands or natural conversation endings
      const lowerInput = userInput.toLowerCase().trim();
      const exitPhrases = [
        "exit",
        "quit",
        "done",
        "close",
        "bye",
        "goodbye",
        "thanks",
        "thank you",
        "that's all",
        "thats all",
        "we can close",
        "close here",
        "end session",
        "stop"
      ];

      const shouldExit =
        !userInput ||
        exitPhrases.some(
          (phrase) => lowerInput === phrase || lowerInput.includes(phrase)
        );

      if (shouldExit) {
        if (this.options.debug) {
          console.log("[DEBUG] User requested exit");
        }
        break;
      }

      // Send new prompt to continue the conversation
      // Using prompt() instead of followUp() because the agent loop has already completed
      if (this.options.debug) {
        console.log("[DEBUG] Sending prompt:", userInput.slice(0, 50));
      }

      await session.prompt(userInput);
    }

    if (this.turns >= this.options.maxTurns) {
      if (this.options.debug) {
        console.log("[DEBUG] Max turns reached:", this.turns);
      }
    }
  }

  private async waitForStreamingToStop(session: PiAgentSession): Promise<void> {
    while (session.isStreaming) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private calculateCost(): number {
    const pricing = MODEL_PRICING[this.options.model];
    if (!pricing) {
      return 0;
    }

    return (
      this.inputTokens * pricing.input + this.outputTokens * pricing.output
    );
  }
}

export const runInteractiveSession = async (
  prompt: string,
  options: Omit<InteractiveSessionOptions, "ioHandler"> & {
    ioHandler: IOHandler;
  }
): Promise<InteractiveSessionResult> => {
  const session = new InteractiveSession(options);
  return session.run(prompt);
};
