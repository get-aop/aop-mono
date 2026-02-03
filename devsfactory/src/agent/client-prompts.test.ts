import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { SQLiteTaskStorage } from "../core/sqlite/sqlite-task-storage";
import type { SubtaskWithContent, TaskWithContent } from "../types";
import { ClientPromptGenerator, type JobType } from "./client-prompts";

const createMockStorage = () => ({
  getTaskWithContent: mock(() =>
    Promise.resolve(null as TaskWithContent | null)
  ),
  getSubtaskWithContent: mock(() =>
    Promise.resolve(null as SubtaskWithContent | null)
  ),
  getPlanContent: mock(() => Promise.resolve(null as string | null))
});

const mockTask: TaskWithContent = {
  folder: "test-task",
  frontmatter: {
    title: "Test Task",
    status: "INPROGRESS",
    created: new Date("2026-01-01"),
    priority: "high",
    tags: ["test"],
    assignee: null,
    dependencies: [],
    branch: "task/test-task",
    startedAt: null,
    completedAt: null,
    durationMs: null
  },
  description: "This is the task description",
  requirements: "Task requirements here",
  acceptanceCriteria: ["Criterion 1", "Criterion 2"]
};

const mockSubtask: SubtaskWithContent = {
  filename: "001-implement-feature.md",
  frontmatter: {
    title: "Implement feature",
    status: "PENDING",
    dependencies: []
  },
  objective: "Implement the feature as described",
  acceptanceCriteria: "- [ ] Feature works\n- [ ] Tests pass",
  tasksChecklist: "- [ ] Write code\n- [ ] Write tests"
};

const mockPlanContent = `---
status: INPROGRESS
task: test-task
created: 2026-01-01T00:00:00Z
---

## Subtasks

1. [001-implement-feature](001-implement-feature.md) (Implement feature)
`;

describe("ClientPromptGenerator", () => {
  let storage: ReturnType<typeof createMockStorage>;
  let generator: ClientPromptGenerator;

  beforeEach(() => {
    storage = createMockStorage();
    generator = new ClientPromptGenerator(
      storage as unknown as SQLiteTaskStorage
    );
  });

  describe("generate with content injection", () => {
    it("should inject task, subtask, and plan content for implementation", async () => {
      storage.getTaskWithContent.mockResolvedValue(mockTask);
      storage.getSubtaskWithContent.mockResolvedValue(mockSubtask);
      storage.getPlanContent.mockResolvedValue(mockPlanContent);

      const prompt = await generator.generate(
        "implementation",
        "test-task",
        "001-implement-feature.md"
      );

      expect(prompt).toContain("## Task");
      expect(prompt).toContain("Test Task");
      expect(prompt).toContain("This is the task description");
      expect(prompt).toContain("## Subtask");
      expect(prompt).toContain("Implement feature");
      expect(prompt).toContain("Implement the feature as described");
      expect(prompt).toContain("## Plan");
      expect(prompt).toContain("INPROGRESS");

      expect(storage.getTaskWithContent).toHaveBeenCalledWith("test-task");
      expect(storage.getSubtaskWithContent).toHaveBeenCalledWith(
        "test-task",
        "001-implement-feature.md"
      );
      expect(storage.getPlanContent).toHaveBeenCalledWith("test-task");
    });

    it("should inject subtask content for review", async () => {
      storage.getSubtaskWithContent.mockResolvedValue(mockSubtask);

      const prompt = await generator.generate(
        "review",
        "test-task",
        "001-implement-feature.md"
      );

      expect(prompt).toContain("## Subtask");
      expect(prompt).toContain("Implement feature");
      expect(storage.getSubtaskWithContent).toHaveBeenCalledWith(
        "test-task",
        "001-implement-feature.md"
      );
    });

    it("should inject task content for planning", async () => {
      storage.getTaskWithContent.mockResolvedValue(mockTask);

      const prompt = await generator.generate("planning", "test-task");

      expect(prompt).toContain("## Task");
      expect(prompt).toContain("Test Task");
      expect(prompt).toContain("This is the task description");
      expect(storage.getTaskWithContent).toHaveBeenCalledWith("test-task");
    });

    it("should inject task and plan content for completing-task", async () => {
      storage.getTaskWithContent.mockResolvedValue(mockTask);
      storage.getPlanContent.mockResolvedValue(mockPlanContent);

      const prompt = await generator.generate("completing-task", "test-task");

      expect(prompt).toContain("## Task");
      expect(prompt).toContain("Test Task");
      expect(prompt).toContain("## Plan");
      expect(storage.getTaskWithContent).toHaveBeenCalledWith("test-task");
      expect(storage.getPlanContent).toHaveBeenCalledWith("test-task");
    });

    it("should inject task and plan content for completion-review", async () => {
      storage.getTaskWithContent.mockResolvedValue(mockTask);
      storage.getPlanContent.mockResolvedValue(mockPlanContent);

      const prompt = await generator.generate("completion-review", "test-task");

      expect(prompt).toContain("## Task");
      expect(prompt).toContain("## Plan");
      expect(storage.getTaskWithContent).toHaveBeenCalledWith("test-task");
      expect(storage.getPlanContent).toHaveBeenCalledWith("test-task");
    });

    it("should throw error for unknown job type", async () => {
      await expect(
        generator.generate("unknown" as JobType, "test-task")
      ).rejects.toThrow("Unknown job type: unknown");
    });
  });

  describe("content formatting", () => {
    it("should format task content as markdown", async () => {
      storage.getTaskWithContent.mockResolvedValue(mockTask);
      storage.getPlanContent.mockResolvedValue(mockPlanContent);

      const prompt = await generator.generate("completing-task", "test-task");

      expect(prompt).toContain("**Title:** Test Task");
      expect(prompt).toContain("**Status:** INPROGRESS");
      expect(prompt).toContain("**Priority:** high");
      expect(prompt).toContain("### Description");
      expect(prompt).toContain("This is the task description");
      expect(prompt).toContain("### Requirements");
      expect(prompt).toContain("Task requirements here");
      expect(prompt).toContain("### Acceptance Criteria");
      expect(prompt).toContain("- [ ] Criterion 1");
      expect(prompt).toContain("- [ ] Criterion 2");
    });

    it("should format subtask content as markdown", async () => {
      storage.getTaskWithContent.mockResolvedValue(mockTask);
      storage.getSubtaskWithContent.mockResolvedValue(mockSubtask);
      storage.getPlanContent.mockResolvedValue(mockPlanContent);

      const prompt = await generator.generate(
        "implementation",
        "test-task",
        "001-implement-feature.md"
      );

      expect(prompt).toContain("**Title:** Implement feature");
      expect(prompt).toContain("**Status:** PENDING");
      expect(prompt).toContain("### Objective");
      expect(prompt).toContain("Implement the feature as described");
      expect(prompt).toContain("### Acceptance Criteria");
      expect(prompt).toContain("- [ ] Feature works");
    });

    it("should handle missing optional fields gracefully", async () => {
      const minimalTask: TaskWithContent = {
        folder: "minimal",
        frontmatter: {
          title: "Minimal Task",
          status: "PENDING",
          created: new Date(),
          priority: "low",
          tags: [],
          assignee: null,
          dependencies: [],
          startedAt: null,
          completedAt: null,
          durationMs: null
        },
        description: "Minimal description"
      };
      storage.getTaskWithContent.mockResolvedValue(minimalTask);

      const prompt = await generator.generate("planning", "minimal");

      expect(prompt).toContain("Minimal Task");
      expect(prompt).toContain("Minimal description");
      expect(prompt).not.toContain("### Requirements");
      expect(prompt).not.toContain("### Acceptance Criteria");
    });

    it("should handle null content from storage gracefully", async () => {
      storage.getTaskWithContent.mockResolvedValue(null);
      storage.getSubtaskWithContent.mockResolvedValue(null);
      storage.getPlanContent.mockResolvedValue(null);

      const prompt = await generator.generate(
        "implementation",
        "missing-task",
        "001-missing.md"
      );

      expect(prompt).toContain("## Task");
      expect(prompt).toContain("*Task not found*");
      expect(prompt).toContain("## Subtask");
      expect(prompt).toContain("*Subtask not found*");
      expect(prompt).toContain("## Plan");
      expect(prompt).toContain("*Plan not found*");
    });
  });

  describe("template placeholders", () => {
    it("should not contain old file path placeholders", async () => {
      storage.getTaskWithContent.mockResolvedValue(mockTask);
      storage.getSubtaskWithContent.mockResolvedValue(mockSubtask);
      storage.getPlanContent.mockResolvedValue(mockPlanContent);

      const prompt = await generator.generate(
        "implementation",
        "test-task",
        "001-implement-feature.md"
      );

      expect(prompt).not.toContain("{{subtaskPath}}");
      expect(prompt).not.toContain("{{taskDir}}");
      expect(prompt).not.toContain("{{taskPath}}");
      expect(prompt).not.toContain("{{reviewPath}}");
      expect(prompt).not.toContain("{{devsfactoryDir}}");
    });

    it("should replace all new content placeholders", async () => {
      storage.getTaskWithContent.mockResolvedValue(mockTask);
      storage.getSubtaskWithContent.mockResolvedValue(mockSubtask);
      storage.getPlanContent.mockResolvedValue(mockPlanContent);

      const prompt = await generator.generate(
        "implementation",
        "test-task",
        "001-implement-feature.md"
      );

      expect(prompt).not.toContain("{{taskContent}}");
      expect(prompt).not.toContain("{{subtaskContent}}");
      expect(prompt).not.toContain("{{planContent}}");
    });
  });
});
