export interface SessionOptions {
  /** Working directory for the Claude process */
  cwd?: string;
  /** Skip permission prompts (dangerous - use for automated testing) */
  dangerouslySkipPermissions?: boolean;
  /** Claude setting sources (defaults to user,project to avoid local .claude shadowing) */
  settingSources?: string;
  /** Timeout in ms for inactivity. Process killed if no output for this duration. */
  inactivityTimeoutMs?: number;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionInput {
  questions: Question[];
}

export interface ClaudeSessionEvents {
  message: [content: string];
  toolUse: [tool: string, input: unknown];
  question: [data: AskUserQuestionInput];
  completed: [output: string];
  error: [code: number, signal?: string];
}

export type StreamEventType = "assistant" | "tool_use" | "tool_result" | "system" | "result";

export interface BaseStreamEvent {
  type: StreamEventType;
  session_id?: string;
}

export interface AssistantEvent extends BaseStreamEvent {
  type: "assistant";
  message: { content: string };
}

export interface ToolUseEvent extends BaseStreamEvent {
  type: "tool_use";
  tool_use: { name: string; id: string; input: unknown };
}

export interface ToolResultEvent extends BaseStreamEvent {
  type: "tool_result";
  tool_result: { tool_use_id: string; content: string };
}

export interface SystemEvent extends BaseStreamEvent {
  type: "system";
  message?: string;
  subtype?: string;
}

export interface ResultEvent extends BaseStreamEvent {
  type: "result";
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

export type StreamEvent =
  | AssistantEvent
  | ToolUseEvent
  | ToolResultEvent
  | SystemEvent
  | ResultEvent;
