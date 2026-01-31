import { describe, expect, it } from "bun:test";
import {
  createUserToolResponse,
  isAskUserQuestionInput,
  isAssistantEvent,
  isInitEvent,
  isResultEvent,
  isTextContent,
  isToolUseContent,
  parseClaudeEvent
} from "./claude-events";

describe("claude-events", () => {
  describe("parseClaudeEvent", () => {
    it("should parse init event", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc123",
        tools: ["Read", "Write"],
        model: "claude-3-opus"
      });

      const event = parseClaudeEvent(line);

      expect(event).not.toBeNull();
      expect(isInitEvent(event)).toBe(true);
      if (isInitEvent(event)) {
        expect(event.session_id).toBe("abc123");
        expect(event.tools).toEqual(["Read", "Write"]);
        expect(event.model).toBe("claude-3-opus");
      }
    });

    it("should parse assistant event with text content", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello, world!" }]
        },
        session_id: "abc123"
      });

      const event = parseClaudeEvent(line);

      expect(event).not.toBeNull();
      expect(isAssistantEvent(event)).toBe(true);
      if (isAssistantEvent(event)) {
        expect(event.message.content).toHaveLength(1);
        expect(isTextContent(event.message.content[0])).toBe(true);
      }
    });

    it("should parse assistant event with tool_use content", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool-123",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "What is your name?",
                    header: "Name",
                    options: [{ label: "Alice", description: "Select Alice" }],
                    multiSelect: false
                  }
                ]
              }
            }
          ]
        },
        session_id: "abc123"
      });

      const event = parseClaudeEvent(line);

      expect(event).not.toBeNull();
      expect(isAssistantEvent(event)).toBe(true);
      if (isAssistantEvent(event)) {
        const content = event.message.content[0];
        expect(isToolUseContent(content)).toBe(true);
        if (isToolUseContent(content)) {
          expect(content.name).toBe("AskUserQuestion");
          expect(isAskUserQuestionInput(content.input)).toBe(true);
        }
      }
    });

    it("should parse result event with success", () => {
      const line = JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Task completed",
        session_id: "abc123",
        total_cost_usd: 0.05
      });

      const event = parseClaudeEvent(line);

      expect(event).not.toBeNull();
      expect(isResultEvent(event)).toBe(true);
      if (isResultEvent(event)) {
        expect(event.subtype).toBe("success");
        expect(event.result).toBe("Task completed");
        expect(event.total_cost_usd).toBe(0.05);
      }
    });

    it("should parse result event with error", () => {
      const line = JSON.stringify({
        type: "result",
        subtype: "error",
        result: "Something went wrong",
        session_id: "abc123",
        total_cost_usd: 0.01
      });

      const event = parseClaudeEvent(line);

      expect(event).not.toBeNull();
      expect(isResultEvent(event)).toBe(true);
      if (isResultEvent(event)) {
        expect(event.subtype).toBe("error");
      }
    });

    it("should return null for invalid JSON", () => {
      const event = parseClaudeEvent("not valid json");
      expect(event).toBeNull();
    });

    it("should return null for unknown event type", () => {
      const line = JSON.stringify({
        type: "unknown",
        data: "something"
      });

      const event = parseClaudeEvent(line);
      expect(event).toBeNull();
    });

    it("should return null for empty string", () => {
      const event = parseClaudeEvent("");
      expect(event).toBeNull();
    });
  });

  describe("createUserToolResponse", () => {
    it("should create a valid tool response", () => {
      const response = createUserToolResponse("tool-123", "Alice");

      expect(response.type).toBe("user");
      expect(response.message.role).toBe("user");
      expect(response.message.content).toHaveLength(1);
      expect(response.message.content[0]!.type).toBe("tool_result");
      expect(response.message.content[0]!.tool_use_id).toBe("tool-123");
      expect(response.message.content[0]!.content).toBe("Alice");
    });

    it("should handle JSON content", () => {
      const jsonContent = JSON.stringify({ answers: { Name: "Alice" } });
      const response = createUserToolResponse("tool-456", jsonContent);

      expect(response.message.content[0]!.content).toBe(jsonContent);
    });
  });

  describe("type guards", () => {
    it("isInitEvent should return false for non-init events", () => {
      expect(isInitEvent(null)).toBe(false);
      expect(isInitEvent(undefined)).toBe(false);
      expect(isInitEvent({})).toBe(false);
      expect(isInitEvent({ type: "assistant" })).toBe(false);
      expect(isInitEvent({ type: "system", subtype: "other" })).toBe(false);
    });

    it("isAssistantEvent should return false for non-assistant events", () => {
      expect(isAssistantEvent(null)).toBe(false);
      expect(isAssistantEvent(undefined)).toBe(false);
      expect(isAssistantEvent({})).toBe(false);
      expect(isAssistantEvent({ type: "system" })).toBe(false);
    });

    it("isResultEvent should return false for non-result events", () => {
      expect(isResultEvent(null)).toBe(false);
      expect(isResultEvent(undefined)).toBe(false);
      expect(isResultEvent({})).toBe(false);
      expect(isResultEvent({ type: "assistant" })).toBe(false);
    });

    it("isTextContent should return false for non-text content", () => {
      expect(isTextContent(null)).toBe(false);
      expect(isTextContent(undefined)).toBe(false);
      expect(isTextContent({})).toBe(false);
      expect(isTextContent({ type: "tool_use" })).toBe(false);
    });

    it("isToolUseContent should return false for non-tool_use content", () => {
      expect(isToolUseContent(null)).toBe(false);
      expect(isToolUseContent(undefined)).toBe(false);
      expect(isToolUseContent({})).toBe(false);
      expect(isToolUseContent({ type: "text" })).toBe(false);
    });

    it("isAskUserQuestionInput should validate questions array", () => {
      expect(isAskUserQuestionInput(null)).toBe(false);
      expect(isAskUserQuestionInput(undefined)).toBe(false);
      expect(isAskUserQuestionInput({})).toBe(false);
      expect(isAskUserQuestionInput({ questions: "not array" })).toBe(false);
      expect(isAskUserQuestionInput({ questions: [] })).toBe(true);
      expect(
        isAskUserQuestionInput({ questions: [{ question: "test" }] })
      ).toBe(true);
    });
  });
});
