import { beforeEach, describe, expect, test } from "bun:test";
import type { AskUserQuestionInput } from "@aop/llm-provider";
import { createQuestionEnforcer, type QuestionEnforcer } from "./question-enforcer.ts";

describe("create-task/question-enforcer", () => {
  let enforcer: QuestionEnforcer;

  beforeEach(() => {
    enforcer = createQuestionEnforcer();
  });

  describe("validate", () => {
    test("accepts a single question", () => {
      const input: AskUserQuestionInput = {
        questions: [{ question: "What is your name?" }],
      };

      const result = enforcer.validate(input);

      expect(result.valid).toBe(true);
      expect(result.question).toEqual({ question: "What is your name?" });
      expect(result.errorMessage).toBeUndefined();
    });

    test("accepts a single question with options", () => {
      const input: AskUserQuestionInput = {
        questions: [
          {
            question: "Which framework?",
            header: "Framework",
            options: [
              { label: "React", description: "A JavaScript library" },
              { label: "Vue", description: "A progressive framework" },
            ],
            multiSelect: false,
          },
        ],
      };

      const result = enforcer.validate(input);

      expect(result.valid).toBe(true);
      expect(result.question?.question).toBe("Which framework?");
    });

    test("rejects multiple questions", () => {
      const input: AskUserQuestionInput = {
        questions: [{ question: "First question?" }, { question: "Second question?" }],
      };

      const result = enforcer.validate(input);

      expect(result.valid).toBe(false);
      expect(result.question).toBeUndefined();
      expect(result.errorMessage).toContain("one question at a time");
      expect(result.errorMessage).toContain("2 questions");
    });

    test("rejects empty questions array", () => {
      const input: AskUserQuestionInput = {
        questions: [],
      };

      const result = enforcer.validate(input);

      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain("No questions provided");
    });

    test("resets retry count after valid single question", () => {
      const twoQuestions: AskUserQuestionInput = {
        questions: [{ question: "Q1?" }, { question: "Q2?" }],
      };
      const oneQuestion: AskUserQuestionInput = {
        questions: [{ question: "Q1?" }],
      };

      enforcer.validate(twoQuestions);
      expect(enforcer.getRetryCount()).toBe(1);

      enforcer.validate(oneQuestion);
      expect(enforcer.getRetryCount()).toBe(0);
    });
  });

  describe("retry tracking", () => {
    test("tracks multi-question violations", () => {
      const input: AskUserQuestionInput = {
        questions: [{ question: "Q1?" }, { question: "Q2?" }],
      };

      enforcer.validate(input);
      expect(enforcer.getRetryCount()).toBe(1);

      enforcer.validate(input);
      expect(enforcer.getRetryCount()).toBe(2);

      enforcer.validate(input);
      expect(enforcer.getRetryCount()).toBe(3);
    });

    test("fails after exceeding max retries (default 5)", () => {
      const input: AskUserQuestionInput = {
        questions: [{ question: "Q1?" }, { question: "Q2?" }],
      };

      for (let i = 0; i < 5; i++) {
        const result = enforcer.validate(input);
        expect(result.valid).toBe(false);
        expect(result.errorMessage).toContain("one question at a time");
      }

      const result = enforcer.validate(input);
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain("Exceeded maximum");
    });

    test("respects custom max retries option", () => {
      const customEnforcer = createQuestionEnforcer({ maxMultiQuestionRetries: 2 });
      const input: AskUserQuestionInput = {
        questions: [{ question: "Q1?" }, { question: "Q2?" }],
      };

      customEnforcer.validate(input);
      customEnforcer.validate(input);

      const result = customEnforcer.validate(input);
      expect(result.errorMessage).toContain("Exceeded maximum");
    });
  });

  describe("question count tracking", () => {
    test("starts at zero", () => {
      expect(enforcer.getQuestionCount()).toBe(0);
    });

    test("increments question count", () => {
      enforcer.incrementQuestionCount();
      expect(enforcer.getQuestionCount()).toBe(1);

      enforcer.incrementQuestionCount();
      expect(enforcer.getQuestionCount()).toBe(2);
    });

    test("detects when max questions reached (default 5)", () => {
      for (let i = 0; i < 4; i++) {
        enforcer.incrementQuestionCount();
        expect(enforcer.isMaxQuestionsReached()).toBe(false);
      }

      enforcer.incrementQuestionCount();
      expect(enforcer.isMaxQuestionsReached()).toBe(true);
    });

    test("respects custom max question count option", () => {
      const customEnforcer = createQuestionEnforcer({ maxQuestionCount: 3 });

      customEnforcer.incrementQuestionCount();
      customEnforcer.incrementQuestionCount();
      expect(customEnforcer.isMaxQuestionsReached()).toBe(false);

      customEnforcer.incrementQuestionCount();
      expect(customEnforcer.isMaxQuestionsReached()).toBe(true);
    });

    test("treats zero max question count as unlimited", () => {
      const customEnforcer = createQuestionEnforcer({ maxQuestionCount: 0 });

      for (let i = 0; i < 10; i++) {
        customEnforcer.incrementQuestionCount();
        expect(customEnforcer.isMaxQuestionsReached()).toBe(false);
      }
    });
  });

  describe("reset", () => {
    test("resets all counters and topics", () => {
      const input: AskUserQuestionInput = {
        questions: [{ question: "Q1?" }, { question: "Q2?" }],
      };

      enforcer.validate(input);
      enforcer.validate(input);
      enforcer.incrementQuestionCount();
      enforcer.incrementQuestionCount();

      enforcer.validate({ questions: [{ question: "Test?", header: "Apply method" }] });

      expect(enforcer.getRetryCount()).toBe(0);
      expect(enforcer.getQuestionCount()).toBe(2);
      expect(enforcer.getAskedTopics()).toContain("Apply method");

      enforcer.reset();

      expect(enforcer.getRetryCount()).toBe(0);
      expect(enforcer.getQuestionCount()).toBe(0);
      expect(enforcer.getAskedTopics()).toHaveLength(0);
    });
  });

  describe("duplicate topic detection", () => {
    test("accepts questions with different headers", () => {
      const q1: AskUserQuestionInput = {
        questions: [{ question: "How to apply?", header: "Apply method" }],
      };
      const q2: AskUserQuestionInput = {
        questions: [{ question: "What about conflicts?", header: "Conflict handling" }],
      };

      expect(enforcer.validate(q1).valid).toBe(true);
      expect(enforcer.validate(q2).valid).toBe(true);
      expect(enforcer.getAskedTopics()).toEqual(["Apply method", "Conflict handling"]);
    });

    test("rejects questions with exact same header", () => {
      const q1: AskUserQuestionInput = {
        questions: [{ question: "How to apply?", header: "Apply method" }],
      };
      const q2: AskUserQuestionInput = {
        questions: [{ question: "What about applying?", header: "Apply method" }],
      };

      expect(enforcer.validate(q1).valid).toBe(true);

      const result = enforcer.validate(q2);
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain("Duplicate question");
      expect(result.errorMessage).not.toContain("BRAINSTORM_COMPLETE");
      expect(result.errorMessage).toContain("How to apply?");
    });

    test("rejects questions with similar headers (case insensitive)", () => {
      const q1: AskUserQuestionInput = {
        questions: [{ question: "How?", header: "Apply Method" }],
      };
      const q2: AskUserQuestionInput = {
        questions: [{ question: "What?", header: "apply method" }],
      };

      expect(enforcer.validate(q1).valid).toBe(true);

      const result = enforcer.validate(q2);
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain("Duplicate question");
      expect(result.errorMessage).not.toContain("BRAINSTORM_COMPLETE");
    });

    test("rejects questions with headers that contain each other", () => {
      const q1: AskUserQuestionInput = {
        questions: [{ question: "How?", header: "Cleanup" }],
      };
      const q2: AskUserQuestionInput = {
        questions: [{ question: "What?", header: "Post-apply cleanup" }],
      };

      expect(enforcer.validate(q1).valid).toBe(true);

      const result = enforcer.validate(q2);
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain("Duplicate question");
      expect(result.errorMessage).not.toContain("BRAINSTORM_COMPLETE");
      expect(result.errorMessage).toContain("How?");
    });

    test("rejects questions with similar option sets", () => {
      const q1: AskUserQuestionInput = {
        questions: [
          {
            question: "How should users access the popup?",
            header: "Entry Point",
            options: [
              { label: "Floating Action Button (Recommended)" },
              { label: "Header Button" },
              { label: "Keyboard Shortcut" },
            ],
          },
        ],
      };
      const q2: AskUserQuestionInput = {
        questions: [
          {
            question: "How should the chat popup be triggered?",
            header: "Trigger",
            options: [
              { label: "Floating action button" },
              { label: "Header button" },
              { label: "Keyboard shortcut" },
              { label: "Multiple triggers" },
            ],
          },
        ],
      };

      expect(enforcer.validate(q1).valid).toBe(true);

      const result = enforcer.validate(q2);
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain("Duplicate question");
      expect(result.errorMessage).not.toContain("BRAINSTORM_COMPLETE");
    });

    test("rejects questions with similar text and no options", () => {
      const q1: AskUserQuestionInput = {
        questions: [{ question: "How should users open the popup?", header: "Entry" }],
      };
      const q2: AskUserQuestionInput = {
        questions: [{ question: "How should users access the popup?", header: "Trigger" }],
      };

      expect(enforcer.validate(q1).valid).toBe(true);

      const result = enforcer.validate(q2);
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain("Duplicate question");
      expect(result.errorMessage).not.toContain("BRAINSTORM_COMPLETE");
    });

    test("hard stops after repeated duplicate", () => {
      const q1: AskUserQuestionInput = {
        questions: [{ question: "How to apply?", header: "Apply" }],
      };
      const duplicate: AskUserQuestionInput = {
        questions: [{ question: "What about applying?", header: "Apply" }],
      };

      expect(enforcer.validate(q1).valid).toBe(true);
      expect(enforcer.validate(duplicate).valid).toBe(false);

      const secondDuplicate = enforcer.validate(duplicate);
      expect(secondDuplicate.valid).toBe(false);
      expect(secondDuplicate.errorMessage).not.toContain("BRAINSTORM_COMPLETE");

      const result = enforcer.validate(duplicate);
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain("BRAINSTORM_COMPLETE");
    });

    test("accepts questions without headers", () => {
      const q1: AskUserQuestionInput = {
        questions: [{ question: "First question?" }],
      };
      const q2: AskUserQuestionInput = {
        questions: [{ question: "Second question?" }],
      };

      expect(enforcer.validate(q1).valid).toBe(true);
      expect(enforcer.validate(q2).valid).toBe(true);
    });
  });
});
