export type ClaudeInitEvent = {
  type: "system";
  subtype: "init";
  session_id: string;
  tools: string[];
  model: string;
};

export type ClaudeTextContent = {
  type: "text";
  text: string;
};

export type ClaudeToolUseContent = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type ClaudeAssistantEvent = {
  type: "assistant";
  message: {
    content: Array<ClaudeTextContent | ClaudeToolUseContent>;
  };
  session_id: string;
};

export type ClaudeResultEvent = {
  type: "result";
  subtype: "success" | "error";
  result: string;
  session_id: string;
  total_cost_usd: number;
};

export type ClaudeEvent =
  | ClaudeInitEvent
  | ClaudeAssistantEvent
  | ClaudeResultEvent;

export type AskUserQuestionOption = {
  label: string;
  description: string;
};

export type AskUserQuestion = {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
};

export type AskUserQuestionInput = {
  questions: AskUserQuestion[];
};

export type UserToolResultContent = {
  type: "tool_result";
  content: string;
  tool_use_id: string;
};

export type UserToolResponse = {
  type: "user";
  message: {
    role: "user";
    content: UserToolResultContent[];
  };
};

export interface ClaudeEventHandler {
  onInit: (event: ClaudeInitEvent) => void;
  onText: (text: string) => void;
  onAskQuestion: (
    toolUseId: string,
    input: AskUserQuestionInput
  ) => Promise<string>;
  onToolUse: (toolUseId: string, name: string, input: unknown) => void;
  onResult: (event: ClaudeResultEvent) => void;
  onError: (error: Error) => void;
}

export const isInitEvent = (event: unknown): event is ClaudeInitEvent =>
  typeof event === "object" &&
  event !== null &&
  (event as ClaudeInitEvent).type === "system" &&
  (event as ClaudeInitEvent).subtype === "init";

export const isAssistantEvent = (
  event: unknown
): event is ClaudeAssistantEvent =>
  typeof event === "object" &&
  event !== null &&
  (event as ClaudeAssistantEvent).type === "assistant";

export const isResultEvent = (event: unknown): event is ClaudeResultEvent =>
  typeof event === "object" &&
  event !== null &&
  (event as ClaudeResultEvent).type === "result";

export const isTextContent = (content: unknown): content is ClaudeTextContent =>
  typeof content === "object" &&
  content !== null &&
  (content as ClaudeTextContent).type === "text";

export const isToolUseContent = (
  content: unknown
): content is ClaudeToolUseContent =>
  typeof content === "object" &&
  content !== null &&
  (content as ClaudeToolUseContent).type === "tool_use";

export const isAskUserQuestionInput = (
  input: unknown
): input is AskUserQuestionInput =>
  typeof input === "object" &&
  input !== null &&
  Array.isArray((input as AskUserQuestionInput).questions);

export const parseClaudeEvent = (line: string): ClaudeEvent | null => {
  try {
    const parsed = JSON.parse(line);
    if (
      isInitEvent(parsed) ||
      isAssistantEvent(parsed) ||
      isResultEvent(parsed)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

export const createUserToolResponse = (
  toolUseId: string,
  content: string
): UserToolResponse => ({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        content,
        tool_use_id: toolUseId
      }
    ]
  }
});
