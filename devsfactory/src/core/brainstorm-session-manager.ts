import { EventEmitter } from "node:events";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import KSUID from "ksuid";
import type {
  BrainstormMessage,
  BrainstormQuestion,
  BrainstormSession,
  SubtaskPreview,
  TaskPreview
} from "../types";
import {
  type ClaudeCodeQuestion,
  ClaudeCodeSession,
  type ClaudeCodeSessionResult
} from "./claude-code-session";
import type { SQLiteBrainstormStorage } from "./sqlite/brainstorm-storage";

export interface BrainstormSessionManagerOptions {
  cwd: string;
  idleTimeoutMs?: number;
  skillContent?: string;
  plannerSkillContent?: string;
  model?: string;
  dangerouslySkipPermissions?: boolean;
  brainstormStorage: SQLiteBrainstormStorage;
}

interface ActiveSession {
  session: BrainstormSession;
  agentId: string;
  claudeSession: ClaudeCodeSession;
  timeoutId?: ReturnType<typeof setTimeout>;
  outputBuffer: string;
  intentionallyEnded: boolean;
  isProcessing: boolean;
  tempDir?: string;
  /** Counter for enforcing one question at a time */
  oneQuestionRetries: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ONE_QUESTION_RETRIES = 5;

const BRAINSTORM_COMPLETE_MARKER = "[BRAINSTORM_COMPLETE]";

const DEFAULT_SKILL_CONTENT = `# Brainstorming Ideas Into Designs

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

## The Process

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each
- **Be flexible** - Go back and clarify when something doesn't make sense`;

const DEFAULT_PLANNER_SKILL_CONTENT = `# Task Planner

Break a task into small, implementable subtasks for parallel agent execution.

## Instructions

1. Read the task.md file provided
2. Design subtasks that are small, focused, and independently testable
3. Create subtask files in the same directory as task.md

## Subtask Format

Each subtask file should be named {NNN}-{slug}.md with this format:

---
title: {title}
status: PENDING
dependencies: [{comma-separated numbers}]
---

### Description

{description}

### Context

{context - file references and patterns to follow}

## Guidelines

- Keep subtasks atomic - one clear responsibility each
- Include specific file references in Context section
- Order subtasks to maximize parallelism
- Reference existing code patterns agents should follow`;

const SUBTASK_FILENAME_REGEX = /^(\d{3})-(.+)\.md$/;

export class BrainstormSessionManager extends EventEmitter {
  private sessions: Map<string, ActiveSession> = new Map();
  private cwd: string;
  private idleTimeoutMs: number;
  private skillContent: string;
  private plannerSkillContent: string;
  private model?: string;
  private dangerouslySkipPermissions: boolean;
  private brainstormStorage: SQLiteBrainstormStorage;

  constructor(options: BrainstormSessionManagerOptions) {
    super();
    this.cwd = options.cwd;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.skillContent = options.skillContent ?? DEFAULT_SKILL_CONTENT;
    this.plannerSkillContent =
      options.plannerSkillContent ?? DEFAULT_PLANNER_SKILL_CONTENT;
    this.model = options.model;
    this.dangerouslySkipPermissions =
      options.dangerouslySkipPermissions ?? false;
    this.brainstormStorage = options.brainstormStorage;

    this.on("_testAgentOutput", this.handleTestOutput.bind(this));
    this.on("_testAgentError", this.handleTestError.bind(this));
    this.on("_testPlanComplete", this.handleTestPlanComplete.bind(this));
  }

  async startSession(initialMessage?: string): Promise<BrainstormSession> {
    const sessionId = this.generateSessionId();
    const now = new Date();

    const messages: BrainstormMessage[] = [];
    if (initialMessage) {
      messages.push({
        id: this.generateMessageId(),
        role: "user",
        content: initialMessage,
        timestamp: now
      });
    }

    const session: BrainstormSession = {
      id: sessionId,
      status: "active",
      messages,
      createdAt: now,
      updatedAt: now
    };

    // Persist to SQLite
    await this.brainstormStorage.create(sessionId);
    if (messages.length > 0) {
      await this.brainstormStorage.update(sessionId, { messages });
    }

    const claudeSession = new ClaudeCodeSession();
    const agentId = this.generateAgentId();

    const activeSession: ActiveSession = {
      session,
      agentId,
      claudeSession,
      outputBuffer: "",
      intentionallyEnded: false,
      isProcessing: false,
      oneQuestionRetries: 0
    };

    this.sessions.set(sessionId, activeSession);
    this.resetIdleTimeout(sessionId);
    this.emit("sessionStarted", { sessionId, agentId });

    this.runClaudeSession(sessionId, initialMessage);

    return session;
  }

  private async runClaudeSession(
    sessionId: string,
    initialMessage?: string
  ): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession || activeSession.intentionallyEnded) return;

    activeSession.isProcessing = true;
    const prompt = this.buildPrompt(initialMessage);

    try {
      const result = await activeSession.claudeSession.run({
        cwd: this.cwd,
        prompt,
        model: this.model,
        dangerouslySkipPermissions: this.dangerouslySkipPermissions
      });

      this.handleClaudeResult(sessionId, result);
    } catch (error) {
      if (!activeSession.intentionallyEnded) {
        this.emit("error", {
          sessionId,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    } finally {
      activeSession.isProcessing = false;
    }
  }

  private handleClaudeResult(
    sessionId: string,
    result: ClaudeCodeSessionResult
  ): void {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession || activeSession.intentionallyEnded) return;

    activeSession.session.claudeSessionId = result.sessionId;
    activeSession.session.updatedAt = new Date();
    this.resetIdleTimeout(sessionId);

    if (result.output) {
      this.processAgentOutput(sessionId, result.output);
    }

    if (result.status === "waiting_for_input" && result.question) {
      // Enforce one question at a time
      if (result.question.questions.length > 1) {
        activeSession.oneQuestionRetries++;

        if (activeSession.oneQuestionRetries > MAX_ONE_QUESTION_RETRIES) {
          this.emit("error", {
            sessionId,
            error: new Error(
              "Claude keeps sending multiple questions despite being asked to send one at a time"
            )
          });
          return;
        }

        // Auto-resume with error message
        const errorMessage = `Error: You MUST ask exactly ONE question at a time. You sent ${result.question.questions.length} questions in a single AskUserQuestion call. This is REQUIRED for non-interactive session management. Call AskUserQuestion again with ONLY ONE question in the questions array. Ask your most important question first, then ask follow-up questions in subsequent turns based on the user's answer.`;

        this.autoResumeWithError(
          sessionId,
          result.question.toolUseId,
          errorMessage
        );
        return;
      }

      // Reset retry counter on successful single question
      activeSession.oneQuestionRetries = 0;

      activeSession.session.status = "waiting";
      activeSession.session.pendingQuestion = this.convertQuestion(
        result.question
      );

      this.emit("waiting", {
        sessionId,
        question: activeSession.session.pendingQuestion
      });
    } else if (result.status === "completed") {
      if (activeSession.outputBuffer.includes(BRAINSTORM_COMPLETE_MARKER)) {
        this.handleBrainstormComplete(sessionId, activeSession.outputBuffer);
      }
    } else if (result.status === "error") {
      this.emit("error", {
        sessionId,
        error: new Error(result.error ?? "Unknown error")
      });
    }
  }

  private convertQuestion(question: ClaudeCodeQuestion): BrainstormQuestion {
    return {
      toolUseId: question.toolUseId,
      questions: question.questions.map((q) => ({
        question: q.question,
        header: q.header,
        options: q.options.map((o) => ({
          label: o.label,
          description: o.description
        })),
        multiSelect: q.multiSelect
      }))
    };
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      throw new Error("Session not found");
    }

    const brainstormMessage: BrainstormMessage = {
      id: this.generateMessageId(),
      role: "user",
      content: message,
      timestamp: new Date()
    };

    activeSession.session.messages.push(brainstormMessage);
    activeSession.session.updatedAt = new Date();
    activeSession.session.pendingQuestion = undefined;

    // Persist to SQLite
    await this.brainstormStorage.addMessage(sessionId, brainstormMessage);

    if (
      activeSession.session.status === "waiting" &&
      activeSession.session.claudeSessionId
    ) {
      activeSession.session.status = "active";
      this.resumeClaudeSession(sessionId, message);
    }

    this.resetIdleTimeout(sessionId);
  }

  private async resumeClaudeSession(
    sessionId: string,
    answer: string
  ): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession || activeSession.intentionallyEnded) return;
    if (!activeSession.session.claudeSessionId) return;

    activeSession.isProcessing = true;

    try {
      const result = await activeSession.claudeSession.run({
        cwd: this.cwd,
        prompt: answer,
        resume: activeSession.session.claudeSessionId,
        model: this.model,
        dangerouslySkipPermissions: this.dangerouslySkipPermissions
      });

      this.handleClaudeResult(sessionId, result);
    } catch (error) {
      if (!activeSession.intentionallyEnded) {
        this.emit("error", {
          sessionId,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    } finally {
      activeSession.isProcessing = false;
    }
  }

  /**
   * Auto-resume a session with an error message for tool enforcement.
   * Used when Claude sends multiple questions instead of one at a time.
   */
  private async autoResumeWithError(
    sessionId: string,
    _toolUseId: string,
    errorMessage: string
  ): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession || activeSession.intentionallyEnded) return;
    if (!activeSession.session.claudeSessionId) return;

    activeSession.isProcessing = true;

    try {
      // Just pass error as prompt without writing to session file
      // This is closer to the reference implementation's kill/resume pattern
      const result = await activeSession.claudeSession.run({
        cwd: this.cwd,
        prompt: errorMessage,
        resume: activeSession.session.claudeSessionId,
        model: this.model,
        dangerouslySkipPermissions: this.dangerouslySkipPermissions
      });

      this.handleClaudeResult(sessionId, result);
    } catch (error) {
      if (!activeSession.intentionallyEnded) {
        this.emit("error", {
          sessionId,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    } finally {
      activeSession.isProcessing = false;
    }
  }

  async endSession(sessionId: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      return;
    }

    activeSession.intentionallyEnded = true;

    if (activeSession.timeoutId) {
      clearTimeout(activeSession.timeoutId);
    }

    // Mark as completed in SQLite
    await this.brainstormStorage.update(sessionId, { status: "completed" });

    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): BrainstormSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  getActiveSessions(): BrainstormSession[] {
    return Array.from(this.sessions.values()).map((s) => s.session);
  }

  async generatePlan(sessionId: string): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) {
      throw new Error("Session not found");
    }

    if (!activeSession.session.taskPreview) {
      throw new Error("Session has no task preview");
    }

    activeSession.session.status = "planning";
    activeSession.session.updatedAt = new Date();

    const tempDir = join(this.cwd, "devsfactory-brainstorm", sessionId);
    await mkdir(tempDir, { recursive: true });
    activeSession.tempDir = tempDir;

    const taskMd = this.buildTaskMd(activeSession.session.taskPreview);
    await Bun.write(join(tempDir, "task.md"), taskMd);

    const prompt = this.buildPlannerPrompt(tempDir);

    try {
      const plannerSession = new ClaudeCodeSession();
      const result = await plannerSession.run({
        cwd: tempDir,
        prompt,
        model: this.model,
        dangerouslySkipPermissions: this.dangerouslySkipPermissions
      });

      if (
        result.status === "completed" ||
        result.status === "waiting_for_input"
      ) {
        await this.handlePlanGenerationComplete(sessionId, tempDir);
      } else {
        this.emit("error", {
          sessionId,
          error: new Error(result.error ?? "Plan generation failed")
        });
      }
    } catch (error) {
      this.emit("error", {
        sessionId,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }

  private buildTaskMd(taskPreview: TaskPreview): string {
    const lines = [
      "---",
      `title: ${taskPreview.title}`,
      "status: PENDING",
      `created: ${new Date().toISOString()}`,
      "priority: medium",
      "tags: []",
      "assignee: null",
      "dependencies: []",
      "---",
      "",
      "## Description",
      "",
      taskPreview.description,
      "",
      "## Requirements",
      "",
      taskPreview.requirements,
      "",
      "## Acceptance Criteria",
      ""
    ];

    for (const criterion of taskPreview.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion}`);
    }

    return lines.join("\n");
  }

  private buildPlannerPrompt(tempDir: string): string {
    return `${this.plannerSkillContent}

## Task File

The task file is located at: ${join(tempDir, "task.md")}

Read this file and create subtask files in the same directory.`;
  }

  private async handlePlanGenerationComplete(
    sessionId: string,
    tempDir: string
  ): Promise<void> {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    const subtaskPreviews = await this.parseSubtaskFiles(tempDir);

    activeSession.session.subtaskPreviews = subtaskPreviews;
    activeSession.session.status = "review";
    activeSession.session.updatedAt = new Date();

    this.emit("planGenerated", { sessionId, subtaskPreviews });

    await rm(tempDir, { recursive: true, force: true });
  }

  private async parseSubtaskFiles(tempDir: string): Promise<SubtaskPreview[]> {
    const glob = new Bun.Glob("[0-9][0-9][0-9]-*.md");
    const matches = await Array.fromAsync(glob.scan({ cwd: tempDir }));

    const subtaskFiles = matches.filter(
      (f) => f !== "task.md" && SUBTASK_FILENAME_REGEX.test(f)
    );

    const subtasks: SubtaskPreview[] = [];

    for (const filename of subtaskFiles) {
      const subtask = await this.parseSubtaskFile(tempDir, filename);
      if (subtask) {
        subtasks.push(subtask);
      }
    }

    return subtasks.sort((a, b) => a.number - b.number);
  }

  private async parseSubtaskFile(
    tempDir: string,
    filename: string
  ): Promise<SubtaskPreview | null> {
    const match = filename.match(SUBTASK_FILENAME_REGEX);
    if (!match) return null;

    const number = Number.parseInt(match[1]!, 10);
    const slug = match[2]!;

    const content = await Bun.file(join(tempDir, filename)).text();
    const { frontmatter, body } = this.parseFrontmatter(content);

    const title = frontmatter.title || slug;
    const dependencies = frontmatter.dependencies || [];
    const sections = this.extractSections(body);

    return {
      number,
      slug,
      title,
      description: sections.description || "",
      context: sections.context,
      dependencies
    };
  }

  private parseFrontmatter(content: string): {
    frontmatter: { title?: string; dependencies?: number[] };
    body: string;
  } {
    const frontmatterMatch = content.match(
      /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/
    );
    if (!frontmatterMatch) {
      return { frontmatter: {}, body: content };
    }

    const frontmatterText = frontmatterMatch[1]!;
    const body = frontmatterMatch[2]!;

    const frontmatter: { title?: string; dependencies?: number[] } = {};

    const titleMatch = frontmatterText.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      frontmatter.title = titleMatch[1]!.trim();
    }

    const depsMatch = frontmatterText.match(/^dependencies:\s*\[([^\]]*)\]$/m);
    if (depsMatch) {
      const depsStr = depsMatch[1]!.trim();
      if (depsStr) {
        frontmatter.dependencies = depsStr
          .split(",")
          .map((d) => Number.parseInt(d.trim(), 10))
          .filter((n) => !Number.isNaN(n));
      } else {
        frontmatter.dependencies = [];
      }
    }

    return { frontmatter, body };
  }

  private extractSections(body: string): {
    description?: string;
    context?: string;
  } {
    const sections: Record<string, string> = {};
    const lines = body.split("\n");
    let currentSection = "";
    let currentContent: string[] = [];

    for (const line of lines) {
      const headerMatch = line.match(/^###\s+(.+)$/);
      if (headerMatch) {
        if (currentSection) {
          sections[currentSection] = currentContent.join("\n").trim();
        }
        currentSection = headerMatch[1]!.toLowerCase().replace(/\s+/g, "_");
        currentContent = [];
      } else if (currentSection) {
        currentContent.push(line);
      }
    }

    if (currentSection) {
      sections[currentSection] = currentContent.join("\n").trim();
    }

    return {
      description: sections.description || undefined,
      context: sections.context || undefined
    };
  }

  private buildPrompt(initialMessage?: string): string {
    const completionInstruction = `

## Completion

When you have gathered enough information to create a task, output the completion marker followed by the task preview JSON:

${BRAINSTORM_COMPLETE_MARKER}
{"title":"Task Title","description":"Task description","requirements":"Requirements text","acceptanceCriteria":["Criterion 1","Criterion 2"]}

The JSON should be on a single line after the marker.`;

    let prompt = `You are a brainstorming assistant helping to define a new development task.

${this.skillContent}
${completionInstruction}`;

    if (initialMessage) {
      prompt += `\n\nThe user wants to discuss: ${initialMessage}`;
    }

    return prompt;
  }

  private processAgentOutput(sessionId: string, text: string): void {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    activeSession.outputBuffer += text;
    activeSession.session.updatedAt = new Date();
    this.resetIdleTimeout(sessionId);

    if (activeSession.outputBuffer.includes(BRAINSTORM_COMPLETE_MARKER)) {
      this.handleBrainstormComplete(sessionId, activeSession.outputBuffer);
      activeSession.outputBuffer = "";
      return;
    }

    const lines = activeSession.outputBuffer.split("\n");
    activeSession.outputBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        const parsedContent = this.parseAgentLine(line);
        if (parsedContent) {
          const message: BrainstormMessage = {
            id: this.generateMessageId(),
            role: "assistant",
            content: parsedContent,
            timestamp: new Date()
          };
          activeSession.session.messages.push(message);
          // Persist to SQLite (fire and forget for streaming)
          this.brainstormStorage.addMessage(sessionId, message).catch(() => {});
          this.emit("message", { sessionId, message });
        }
      }
    }
  }

  private parseAgentLine(line: string): string | null {
    try {
      const data = JSON.parse(line);
      if (data.type === "assistant" && data.message?.content) {
        const parts: string[] = [];
        for (const item of data.message.content) {
          if (item.type === "text" && item.text) {
            parts.push(item.text);
          }
        }
        return parts.length > 0 ? parts.join(" ") : null;
      }
      return null;
    } catch {
      return line.trim() || null;
    }
  }

  private handleBrainstormComplete(sessionId: string, buffer: string): void {
    const markerIndex = buffer.indexOf(BRAINSTORM_COMPLETE_MARKER);
    const afterMarker = buffer.slice(
      markerIndex + BRAINSTORM_COMPLETE_MARKER.length
    );

    let taskPreview: TaskPreview | undefined;

    const jsonMatch = afterMarker.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        taskPreview = JSON.parse(jsonMatch[0]) as TaskPreview;
      } catch {
        // Failed to parse task preview JSON
      }
    }

    const activeSession = this.sessions.get(sessionId);
    if (activeSession) {
      activeSession.session.status = "completed";
      activeSession.session.taskPreview = taskPreview;

      // Persist to SQLite
      this.brainstormStorage
        .update(sessionId, {
          status: "completed",
          partialTaskData: taskPreview ?? {}
        })
        .catch(() => {});
    }

    this.emit("brainstormComplete", { sessionId, taskPreview });
  }

  private resetIdleTimeout(sessionId: string): void {
    const activeSession = this.sessions.get(sessionId);
    if (!activeSession) return;

    if (activeSession.timeoutId) {
      clearTimeout(activeSession.timeoutId);
    }

    activeSession.timeoutId = setTimeout(async () => {
      this.emit("sessionTimeout", { sessionId });
      await this.endSession(sessionId);
    }, this.idleTimeoutMs);
  }

  private generateSessionId(): string {
    return `brainstorm-${KSUID.randomSync().string}`;
  }

  private generateAgentId(): string {
    return `agent-${KSUID.randomSync().string}`;
  }

  private generateMessageId(): string {
    return `msg-${KSUID.randomSync().string}`;
  }

  private handleTestOutput(data: { sessionId: string; content: string }): void {
    this.processAgentOutput(data.sessionId, `${data.content}\n`);
  }

  private handleTestError(data: { sessionId: string; error: Error }): void {
    this.emit("error", { sessionId: data.sessionId, error: data.error });
  }

  private async handleTestPlanComplete(data: {
    sessionId: string;
    taskDir: string;
  }): Promise<void> {
    await this.handlePlanGenerationComplete(data.sessionId, data.taskDir);
  }
}
