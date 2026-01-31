import { describe, expect, test } from "bun:test";
import {
  AgentProcessSchema,
  type AgentType,
  AgentTypeSchema,
  BrainstormDraftSchema,
  type BrainstormMessageRole,
  BrainstormMessageRoleSchema,
  BrainstormMessageSchema,
  BrainstormSessionSchema,
  type BrainstormSessionStatus,
  BrainstormSessionStatusSchema,
  ConfigSchema,
  type GlobalConfig,
  GlobalConfigSchema,
  type OperationMode,
  OperationModeSchema,
  OrchestratorStateSchema,
  PhaseTimingsSchema,
  PlanFrontmatterSchema,
  PlanSchema,
  type PlanStatus,
  PlanStatusSchema,
  type Priority,
  PrioritySchema,
  type ProjectConfig,
  ProjectConfigSchema,
  type ProviderConfig,
  ProviderConfigSchema,
  type ResolvedPaths,
  ResolvedPathsSchema,
  SubtaskFrontmatterSchema,
  SubtaskPreviewSchema,
  SubtaskReferenceSchema,
  SubtaskSchema,
  type SubtaskStatus,
  SubtaskStatusSchema,
  SubtaskTimingSchema,
  TaskFrontmatterSchema,
  TaskPreviewSchema,
  TaskSchema,
  type TaskStatus,
  TaskStatusSchema,
  TaskTimingSchema,
  WatcherEventSchema
} from "./index.ts";

describe("Status Enums", () => {
  describe("TaskStatusSchema", () => {
    test("accepts valid values", () => {
      const validStatuses: TaskStatus[] = [
        "DRAFT",
        "BACKLOG",
        "PENDING",
        "INPROGRESS",
        "BLOCKED",
        "REVIEW",
        "DONE"
      ];
      for (const status of validStatuses) {
        expect(TaskStatusSchema.parse(status)).toBe(status);
      }
    });

    test("rejects invalid values", () => {
      expect(() => TaskStatusSchema.parse("INVALID")).toThrow();
      expect(() => TaskStatusSchema.parse("")).toThrow();
      expect(() => TaskStatusSchema.parse(123)).toThrow();
    });
  });

  describe("SubtaskStatusSchema", () => {
    test("accepts valid values", () => {
      const validStatuses: SubtaskStatus[] = [
        "PENDING",
        "INPROGRESS",
        "AGENT_REVIEW",
        "PENDING_MERGE",
        "MERGE_CONFLICT",
        "DONE",
        "BLOCKED"
      ];
      for (const status of validStatuses) {
        expect(SubtaskStatusSchema.parse(status)).toBe(status);
      }
    });

    test("rejects invalid values", () => {
      expect(() => SubtaskStatusSchema.parse("DRAFT")).toThrow();
      expect(() => SubtaskStatusSchema.parse("REVIEW")).toThrow();
    });
  });

  describe("PlanStatusSchema", () => {
    test("accepts valid values", () => {
      const validStatuses: PlanStatus[] = ["INPROGRESS", "BLOCKED", "REVIEW"];
      for (const status of validStatuses) {
        expect(PlanStatusSchema.parse(status)).toBe(status);
      }
    });

    test("rejects invalid values", () => {
      expect(() => PlanStatusSchema.parse("PENDING")).toThrow();
      expect(() => PlanStatusSchema.parse("DONE")).toThrow();
    });
  });

  describe("PrioritySchema", () => {
    test("accepts valid values", () => {
      const validPriorities: Priority[] = ["high", "medium", "low"];
      for (const priority of validPriorities) {
        expect(PrioritySchema.parse(priority)).toBe(priority);
      }
    });

    test("rejects invalid values", () => {
      expect(() => PrioritySchema.parse("urgent")).toThrow();
      expect(() => PrioritySchema.parse("HIGH")).toThrow();
    });
  });

  describe("AgentTypeSchema", () => {
    test("accepts valid values", () => {
      const validTypes: AgentType[] = ["planning", "implementation", "review"];
      for (const type of validTypes) {
        expect(AgentTypeSchema.parse(type)).toBe(type);
      }
    });

    test("rejects invalid values", () => {
      expect(() => AgentTypeSchema.parse("coding")).toThrow();
      expect(() => AgentTypeSchema.parse("testing")).toThrow();
    });
  });
});

describe("Frontmatter Schemas", () => {
  describe("TaskFrontmatterSchema", () => {
    test("parses with all fields", () => {
      const input = {
        title: "Test Task",
        status: "PENDING",
        created: "2026-01-25T00:00:00Z",
        priority: "high",
        tags: ["tag1", "tag2"],
        assignee: "developer",
        dependencies: ["dep1", "dep2"]
      };

      const result = TaskFrontmatterSchema.parse(input);

      expect(result.title).toBe("Test Task");
      expect(result.status).toBe("PENDING");
      expect(result.created).toBeInstanceOf(Date);
      expect(result.priority).toBe("high");
      expect(result.tags).toEqual(["tag1", "tag2"]);
      expect(result.assignee).toBe("developer");
      expect(result.dependencies).toEqual(["dep1", "dep2"]);
    });

    test("applies defaults for optional fields", () => {
      const input = {
        title: "Minimal Task",
        status: "DRAFT",
        created: "2026-01-25T00:00:00Z",
        priority: "medium"
      };

      const result = TaskFrontmatterSchema.parse(input);

      expect(result.tags).toEqual([]);
      expect(result.assignee).toBeNull();
      expect(result.dependencies).toEqual([]);
    });

    test("coerces ISO date string to Date object", () => {
      const input = {
        title: "Date Test",
        status: "PENDING",
        created: "2026-01-25T12:30:00Z",
        priority: "low"
      };

      const result = TaskFrontmatterSchema.parse(input);

      expect(result.created).toBeInstanceOf(Date);
      expect(result.created.toISOString()).toBe("2026-01-25T12:30:00.000Z");
    });

    test("accepts Date objects directly", () => {
      const date = new Date("2026-01-25T00:00:00Z");
      const input = {
        title: "Date Object Test",
        status: "PENDING",
        created: date,
        priority: "medium"
      };

      const result = TaskFrontmatterSchema.parse(input);

      expect(result.created).toBeInstanceOf(Date);
      expect(result.created.getTime()).toBe(date.getTime());
    });

    test("rejects invalid status", () => {
      const input = {
        title: "Bad Task",
        status: "INVALID_STATUS",
        created: "2026-01-25T00:00:00Z",
        priority: "high"
      };

      expect(() => TaskFrontmatterSchema.parse(input)).toThrow();
    });

    test("rejects missing required fields", () => {
      expect(() => TaskFrontmatterSchema.parse({})).toThrow();
      expect(() =>
        TaskFrontmatterSchema.parse({
          title: "Missing fields"
        })
      ).toThrow();
    });
  });

  describe("PlanFrontmatterSchema", () => {
    test("parses with all fields", () => {
      const input = {
        status: "INPROGRESS",
        task: "parent-task-folder",
        created: "2026-01-25T00:00:00Z"
      };

      const result = PlanFrontmatterSchema.parse(input);

      expect(result.status).toBe("INPROGRESS");
      expect(result.task).toBe("parent-task-folder");
      expect(result.created).toBeInstanceOf(Date);
    });

    test("coerces date from ISO string", () => {
      const input = {
        status: "REVIEW",
        task: "my-task",
        created: "2026-06-15T10:00:00Z"
      };

      const result = PlanFrontmatterSchema.parse(input);

      expect(result.created).toBeInstanceOf(Date);
      expect(result.created.toISOString()).toBe("2026-06-15T10:00:00.000Z");
    });
  });

  describe("SubtaskFrontmatterSchema", () => {
    test("parses with all fields", () => {
      const input = {
        title: "Implement feature",
        status: "PENDING",
        dependencies: [1, 2, 3]
      };

      const result = SubtaskFrontmatterSchema.parse(input);

      expect(result.title).toBe("Implement feature");
      expect(result.status).toBe("PENDING");
      expect(result.dependencies).toEqual([1, 2, 3]);
    });

    test("applies default for dependencies", () => {
      const input = {
        title: "Independent subtask",
        status: "INPROGRESS"
      };

      const result = SubtaskFrontmatterSchema.parse(input);

      expect(result.dependencies).toEqual([]);
    });

    test("rejects invalid status for subtask", () => {
      const input = {
        title: "Bad subtask",
        status: "DRAFT" // Not valid for subtasks
      };

      expect(() => SubtaskFrontmatterSchema.parse(input)).toThrow();
    });
  });
});

describe("Entity Schemas", () => {
  describe("SubtaskReferenceSchema", () => {
    test("parses subtask reference", () => {
      const input = {
        number: 1,
        slug: "setup-database",
        title: "Set up database",
        dependencies: [0]
      };

      const result = SubtaskReferenceSchema.parse(input);

      expect(result.number).toBe(1);
      expect(result.slug).toBe("setup-database");
      expect(result.title).toBe("Set up database");
      expect(result.dependencies).toEqual([0]);
    });
  });

  describe("TaskSchema", () => {
    test("parses full task", () => {
      const input = {
        folder: "20260125180901-my-task",
        frontmatter: {
          title: "My Task",
          status: "PENDING",
          created: "2026-01-25T00:00:00Z",
          priority: "high"
        },
        description: "Task description here",
        requirements: "## Requirements\n- Item 1\n- Item 2",
        acceptanceCriteria: [
          { text: "Criterion 1", checked: false },
          { text: "Criterion 2", checked: true }
        ]
      };

      const result = TaskSchema.parse(input);

      expect(result.folder).toBe("20260125180901-my-task");
      expect(result.frontmatter.title).toBe("My Task");
      expect(result.description).toBe("Task description here");
      expect(result.acceptanceCriteria).toHaveLength(2);
      expect(result.notes).toBeUndefined();
    });

    test("parses task with optional notes", () => {
      const input = {
        folder: "task-folder",
        frontmatter: {
          title: "Task with notes",
          status: "DRAFT",
          created: "2026-01-25T00:00:00Z",
          priority: "low"
        },
        description: "Description",
        requirements: "Requirements",
        acceptanceCriteria: [],
        notes: "Some additional notes"
      };

      const result = TaskSchema.parse(input);

      expect(result.notes).toBe("Some additional notes");
    });
  });

  describe("PlanSchema", () => {
    test("parses plan with subtasks", () => {
      const input = {
        folder: "20260125180901-my-task",
        frontmatter: {
          status: "INPROGRESS",
          task: "my-task",
          created: "2026-01-25T00:00:00Z"
        },
        subtasks: [
          { number: 1, slug: "first", title: "First", dependencies: [] },
          { number: 2, slug: "second", title: "Second", dependencies: [1] }
        ]
      };

      const result = PlanSchema.parse(input);

      expect(result.folder).toBe("20260125180901-my-task");
      expect(result.subtasks).toHaveLength(2);
      expect(result.subtasks[0]?.title).toBe("First");
    });
  });

  describe("SubtaskSchema", () => {
    test("parses subtask with all fields", () => {
      const input = {
        filename: "001-setup-database.md",
        number: 1,
        slug: "setup-database",
        frontmatter: {
          title: "Set up database",
          status: "PENDING",
          dependencies: []
        },
        description: "Create the database schema",
        context: "Use PostgreSQL",
        result: "Database created successfully",
        review: "Looks good",
        blockers: "None"
      };

      const result = SubtaskSchema.parse(input);

      expect(result.filename).toBe("001-setup-database.md");
      expect(result.number).toBe(1);
      expect(result.slug).toBe("setup-database");
      expect(result.context).toBe("Use PostgreSQL");
      expect(result.result).toBe("Database created successfully");
    });

    test("parses subtask with optional fields missing", () => {
      const input = {
        filename: "002-implement-api.md",
        number: 2,
        slug: "implement-api",
        frontmatter: {
          title: "Implement API",
          status: "INPROGRESS"
        },
        description: "Build the REST API"
      };

      const result = SubtaskSchema.parse(input);

      expect(result.context).toBeUndefined();
      expect(result.result).toBeUndefined();
      expect(result.review).toBeUndefined();
      expect(result.blockers).toBeUndefined();
    });
  });
});

describe("Config Schemas", () => {
  describe("AgentProcessSchema", () => {
    test("parses agent process", () => {
      const input = {
        id: "agent-123",
        type: "implementation",
        taskFolder: "20260125180901-my-task",
        subtaskFile: "001-setup.md",
        pid: 12345,
        startedAt: "2026-01-25T10:00:00Z"
      };

      const result = AgentProcessSchema.parse(input);

      expect(result.id).toBe("agent-123");
      expect(result.type).toBe("implementation");
      expect(result.taskFolder).toBe("20260125180901-my-task");
      expect(result.subtaskFile).toBe("001-setup.md");
      expect(result.pid).toBe(12345);
      expect(result.startedAt).toBeInstanceOf(Date);
    });

    test("parses agent process without optional subtaskFile", () => {
      const input = {
        id: "planner-1",
        type: "planning",
        taskFolder: "task-folder",
        pid: 9999,
        startedAt: "2026-01-25T00:00:00Z"
      };

      const result = AgentProcessSchema.parse(input);

      expect(result.subtaskFile).toBeUndefined();
    });
  });

  describe("ConfigSchema", () => {
    test("parses config with all fields", () => {
      const input = {
        maxConcurrentAgents: 5,
        devsfactoryDir: ".factory",
        worktreesDir: ".trees"
      };

      const result = ConfigSchema.parse(input);

      expect(result.maxConcurrentAgents).toBe(5);
      expect(result.devsfactoryDir).toBe(".factory");
      expect(result.worktreesDir).toBe(".trees");
    });

    test("applies defaults for missing fields", () => {
      const result = ConfigSchema.parse({});

      expect(result.maxConcurrentAgents).toBe(2);
      expect(result.devsfactoryDir).toBe(".devsfactory");
      expect(result.worktreesDir).toBe(".worktrees");
    });

    test("partially overrides defaults", () => {
      const input = {
        maxConcurrentAgents: 10
      };

      const result = ConfigSchema.parse(input);

      expect(result.maxConcurrentAgents).toBe(10);
      expect(result.devsfactoryDir).toBe(".devsfactory");
      expect(result.worktreesDir).toBe(".worktrees");
    });

    test("parses new orchestrator config fields with defaults", () => {
      const result = ConfigSchema.parse({});

      expect(result.debounceMs).toBe(100);
      expect(result.retryBackoff).toEqual({
        initialMs: 2000,
        maxMs: 300000,
        maxAttempts: 5
      });
      expect(result.ignorePatterns).toEqual([
        ".git",
        "*.swp",
        "*.tmp",
        "*~",
        ".DS_Store"
      ]);
    });

    test("accepts custom orchestrator config values", () => {
      const input = {
        debounceMs: 200,
        retryBackoff: {
          initialMs: 5000,
          maxMs: 600000
        },
        ignorePatterns: [".git", "node_modules"]
      };

      const result = ConfigSchema.parse(input);

      expect(result.debounceMs).toBe(200);
      expect(result.retryBackoff.initialMs).toBe(5000);
      expect(result.retryBackoff.maxMs).toBe(600000);
      expect(result.ignorePatterns).toEqual([".git", "node_modules"]);
    });

    test("applies partial defaults for retryBackoff", () => {
      const input = {
        retryBackoff: {
          initialMs: 3000
        }
      };

      const result = ConfigSchema.parse(input);

      expect(result.retryBackoff.initialMs).toBe(3000);
      expect(result.retryBackoff.maxMs).toBe(300000);
    });
  });

  describe("OrchestratorStateSchema", () => {
    test("parses orchestrator state", () => {
      const input = {
        tasks: [
          {
            folder: "task-1",
            frontmatter: {
              title: "Task 1",
              status: "PENDING",
              created: new Date(),
              priority: "high"
            },
            description: "Desc",
            requirements: "Req",
            acceptanceCriteria: []
          }
        ],
        plans: {
          "task-1": {
            folder: "task-1",
            frontmatter: {
              status: "INPROGRESS",
              task: "task-1",
              created: new Date()
            },
            subtasks: []
          }
        },
        subtasks: {
          "task-1": [
            {
              filename: "001-sub.md",
              number: 1,
              slug: "sub",
              frontmatter: { title: "Sub", status: "PENDING" },
              description: "Desc"
            }
          ]
        }
      };

      const result = OrchestratorStateSchema.parse(input);

      expect(result.tasks).toHaveLength(1);
      expect(result.plans["task-1"]).toBeDefined();
      expect(result.subtasks["task-1"]).toHaveLength(1);
    });
  });

  describe("WatcherEventSchema", () => {
    test("parses taskChanged event", () => {
      const input = {
        type: "taskChanged",
        taskFolder: "20260125180901-my-task"
      };

      const result = WatcherEventSchema.parse(input);

      expect(result.type).toBe("taskChanged");
      expect(result.taskFolder).toBe("20260125180901-my-task");
    });

    test("parses planChanged event", () => {
      const input = {
        type: "planChanged",
        taskFolder: "task-folder"
      };

      const result = WatcherEventSchema.parse(input);

      expect(result.type).toBe("planChanged");
    });

    test("parses subtaskChanged event with filename", () => {
      const input = {
        type: "subtaskChanged",
        taskFolder: "task-folder",
        filename: "001-setup.md"
      };

      const result = WatcherEventSchema.parse(input);

      expect(result.type).toBe("subtaskChanged");
      expect(result.filename).toBe("001-setup.md");
    });

    test("parses reviewChanged event", () => {
      const input = {
        type: "reviewChanged",
        taskFolder: "task-folder"
      };

      const result = WatcherEventSchema.parse(input);

      expect(result.type).toBe("reviewChanged");
    });

    test("rejects invalid event type", () => {
      const input = {
        type: "invalidEvent",
        taskFolder: "task-folder"
      };

      expect(() => WatcherEventSchema.parse(input)).toThrow();
    });
  });
});

describe("Type Exports", () => {
  test("exported types are correctly inferred", () => {
    const taskStatus: TaskStatus = "PENDING";
    const subtaskStatus: SubtaskStatus = "AGENT_REVIEW";
    const planStatus: PlanStatus = "REVIEW";
    const priority: Priority = "high";
    const agentType: AgentType = "implementation";

    expect(taskStatus).toBe("PENDING");
    expect(subtaskStatus).toBe("AGENT_REVIEW");
    expect(planStatus).toBe("REVIEW");
    expect(priority).toBe("high");
    expect(agentType).toBe("implementation");
  });
});

describe("Brainstorm Session Schemas", () => {
  describe("BrainstormSessionStatusSchema", () => {
    test("accepts valid values", () => {
      const validStatuses: BrainstormSessionStatus[] = [
        "active",
        "brainstorming",
        "planning",
        "review",
        "completed",
        "cancelled"
      ];
      for (const status of validStatuses) {
        expect(BrainstormSessionStatusSchema.parse(status)).toBe(status);
      }
    });

    test("rejects invalid values", () => {
      expect(() => BrainstormSessionStatusSchema.parse("INVALID")).toThrow();
      expect(() => BrainstormSessionStatusSchema.parse("")).toThrow();
      expect(() => BrainstormSessionStatusSchema.parse(123)).toThrow();
    });
  });

  describe("BrainstormMessageRoleSchema", () => {
    test("accepts valid values", () => {
      const validRoles: BrainstormMessageRole[] = ["user", "assistant"];
      for (const role of validRoles) {
        expect(BrainstormMessageRoleSchema.parse(role)).toBe(role);
      }
    });

    test("rejects invalid values", () => {
      expect(() => BrainstormMessageRoleSchema.parse("system")).toThrow();
      expect(() => BrainstormMessageRoleSchema.parse("bot")).toThrow();
    });
  });

  describe("BrainstormMessageSchema", () => {
    test("parses with all fields", () => {
      const input = {
        id: "msg_123abc",
        role: "user",
        content: "Hello, I need help with a feature",
        timestamp: "2026-01-28T10:00:00Z"
      };

      const result = BrainstormMessageSchema.parse(input);

      expect(result.id).toBe("msg_123abc");
      expect(result.role).toBe("user");
      expect(result.content).toBe("Hello, I need help with a feature");
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    test("coerces timestamp from string to Date", () => {
      const input = {
        id: "msg_456def",
        role: "assistant",
        content: "I can help you with that",
        timestamp: "2026-01-28T10:05:00Z"
      };

      const result = BrainstormMessageSchema.parse(input);

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.toISOString()).toBe("2026-01-28T10:05:00.000Z");
    });

    test("accepts Date object directly", () => {
      const date = new Date("2026-01-28T10:00:00Z");
      const input = {
        id: "msg_789ghi",
        role: "user",
        content: "Test message",
        timestamp: date
      };

      const result = BrainstormMessageSchema.parse(input);

      expect(result.timestamp.getTime()).toBe(date.getTime());
    });

    test("rejects invalid role", () => {
      const input = {
        id: "msg_bad",
        role: "system",
        content: "Bad message",
        timestamp: "2026-01-28T10:00:00Z"
      };

      expect(() => BrainstormMessageSchema.parse(input)).toThrow();
    });
  });

  describe("TaskPreviewSchema", () => {
    test("parses with all fields", () => {
      const input = {
        title: "Add User Authentication",
        description: "Implement user login and registration",
        requirements: "- Login form\n- Registration form\n- Password reset",
        acceptanceCriteria: ["Users can register", "Users can login"]
      };

      const result = TaskPreviewSchema.parse(input);

      expect(result.title).toBe("Add User Authentication");
      expect(result.description).toBe("Implement user login and registration");
      expect(result.requirements).toBe(
        "- Login form\n- Registration form\n- Password reset"
      );
      expect(result.acceptanceCriteria).toEqual([
        "Users can register",
        "Users can login"
      ]);
    });
  });

  describe("SubtaskPreviewSchema", () => {
    test("parses with all fields", () => {
      const input = {
        number: 1,
        slug: "create-login-form",
        title: "Create login form component",
        description: "Build the UI for user login",
        context: "Reference src/components/Form.tsx for styling patterns",
        dependencies: [1, 2]
      };

      const result = SubtaskPreviewSchema.parse(input);

      expect(result.number).toBe(1);
      expect(result.slug).toBe("create-login-form");
      expect(result.title).toBe("Create login form component");
      expect(result.description).toBe("Build the UI for user login");
      expect(result.context).toBe(
        "Reference src/components/Form.tsx for styling patterns"
      );
      expect(result.dependencies).toEqual([1, 2]);
    });

    test("applies default for dependencies and optional context", () => {
      const input = {
        number: 2,
        slug: "independent-subtask",
        title: "Independent subtask",
        description: "No dependencies"
      };

      const result = SubtaskPreviewSchema.parse(input);

      expect(result.dependencies).toEqual([]);
      expect(result.context).toBeUndefined();
    });
  });

  describe("BrainstormSessionSchema", () => {
    test("parses with required fields only", () => {
      const input = {
        id: "session_abc123",
        status: "brainstorming",
        messages: [],
        createdAt: "2026-01-28T10:00:00Z",
        updatedAt: "2026-01-28T10:00:00Z"
      };

      const result = BrainstormSessionSchema.parse(input);

      expect(result.id).toBe("session_abc123");
      expect(result.status).toBe("brainstorming");
      expect(result.messages).toEqual([]);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.taskPreview).toBeUndefined();
      expect(result.subtaskPreviews).toBeUndefined();
    });

    test("parses with messages", () => {
      const input = {
        id: "session_def456",
        status: "brainstorming",
        messages: [
          {
            id: "msg_1",
            role: "user",
            content: "I want to add auth",
            timestamp: "2026-01-28T10:00:00Z"
          },
          {
            id: "msg_2",
            role: "assistant",
            content: "What type of auth?",
            timestamp: "2026-01-28T10:01:00Z"
          }
        ],
        createdAt: "2026-01-28T10:00:00Z",
        updatedAt: "2026-01-28T10:01:00Z"
      };

      const result = BrainstormSessionSchema.parse(input);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]?.role).toBe("user");
      expect(result.messages[1]?.role).toBe("assistant");
    });

    test("parses with taskPreview", () => {
      const input = {
        id: "session_ghi789",
        status: "planning",
        messages: [],
        createdAt: "2026-01-28T10:00:00Z",
        updatedAt: "2026-01-28T10:30:00Z",
        taskPreview: {
          title: "User Authentication",
          description: "Add login and registration",
          requirements: "OAuth support",
          acceptanceCriteria: ["Login works"]
        }
      };

      const result = BrainstormSessionSchema.parse(input);

      expect(result.taskPreview).toBeDefined();
      expect(result.taskPreview?.title).toBe("User Authentication");
    });

    test("parses with subtaskPreviews", () => {
      const input = {
        id: "session_jkl012",
        status: "review",
        messages: [],
        createdAt: "2026-01-28T10:00:00Z",
        updatedAt: "2026-01-28T11:00:00Z",
        taskPreview: {
          title: "Auth Feature",
          description: "Auth description",
          requirements: "Requirements",
          acceptanceCriteria: []
        },
        subtaskPreviews: [
          {
            number: 1,
            slug: "setup",
            title: "Setup",
            description: "Initial setup",
            dependencies: []
          },
          {
            number: 2,
            slug: "login",
            title: "Login",
            description: "Login form",
            dependencies: [1]
          }
        ]
      };

      const result = BrainstormSessionSchema.parse(input);

      expect(result.subtaskPreviews).toHaveLength(2);
      expect(result.subtaskPreviews?.[0]?.title).toBe("Setup");
      expect(result.subtaskPreviews?.[0]?.number).toBe(1);
      expect(result.subtaskPreviews?.[0]?.slug).toBe("setup");
      expect(result.subtaskPreviews?.[1]?.dependencies).toEqual([1]);
    });
  });

  describe("BrainstormDraftSchema", () => {
    test("parses with all fields", () => {
      const input = {
        sessionId: "session_abc",
        messages: [
          {
            id: "msg_1",
            role: "user",
            content: "Help me build a feature",
            timestamp: "2026-01-28T10:00:00Z"
          }
        ],
        partialTaskData: {
          title: "Partial Title"
        },
        status: "brainstorming",
        createdAt: "2026-01-28T10:00:00Z",
        updatedAt: "2026-01-28T10:05:00Z"
      };

      const result = BrainstormDraftSchema.parse(input);

      expect(result.sessionId).toBe("session_abc");
      expect(result.messages).toHaveLength(1);
      expect(result.partialTaskData).toEqual({ title: "Partial Title" });
      expect(result.status).toBe("brainstorming");
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    test("accepts partial task data with any combination of fields", () => {
      const input = {
        sessionId: "session_def",
        messages: [],
        partialTaskData: {
          description: "Only description"
        },
        status: "active",
        createdAt: "2026-01-28T10:00:00Z",
        updatedAt: "2026-01-28T10:00:00Z"
      };

      const result = BrainstormDraftSchema.parse(input);

      expect(result.partialTaskData).toEqual({
        description: "Only description"
      });
    });

    test("accepts empty partial task data", () => {
      const input = {
        sessionId: "session_ghi",
        messages: [],
        partialTaskData: {},
        status: "active",
        createdAt: "2026-01-28T10:00:00Z",
        updatedAt: "2026-01-28T10:00:00Z"
      };

      const result = BrainstormDraftSchema.parse(input);

      expect(result.partialTaskData).toEqual({});
    });
  });
});

describe("Brainstorm Type Exports", () => {
  test("exported brainstorm types are correctly inferred", () => {
    const sessionStatus: BrainstormSessionStatus = "brainstorming";
    const messageRole: BrainstormMessageRole = "assistant";

    expect(sessionStatus).toBe("brainstorming");
    expect(messageRole).toBe("assistant");
  });
});

describe("Extended AgentTypeSchema", () => {
  test("accepts new agent types for orchestrator", () => {
    const newTypes: AgentType[] = [
      "completing-task",
      "completion-review",
      "conflict-solver"
    ];
    for (const type of newTypes) {
      expect(AgentTypeSchema.parse(type)).toBe(type);
    }
  });

  test("still accepts existing agent types", () => {
    const existingTypes: AgentType[] = ["planning", "implementation", "review"];
    for (const type of existingTypes) {
      expect(AgentTypeSchema.parse(type)).toBe(type);
    }
  });
});

describe("Timing Schemas", () => {
  describe("PhaseTimingsSchema", () => {
    test("parses with all phase durations", () => {
      const input = {
        implementation: 120000,
        review: 60000,
        merge: 5000,
        conflictSolver: 30000
      };

      const result = PhaseTimingsSchema.parse(input);

      expect(result.implementation).toBe(120000);
      expect(result.review).toBe(60000);
      expect(result.merge).toBe(5000);
      expect(result.conflictSolver).toBe(30000);
    });

    test("applies null defaults for missing fields", () => {
      const result = PhaseTimingsSchema.parse({});

      expect(result.implementation).toBeNull();
      expect(result.review).toBeNull();
      expect(result.merge).toBeNull();
      expect(result.conflictSolver).toBeNull();
    });

    test("accepts null values explicitly", () => {
      const input = {
        implementation: null,
        review: 60000,
        merge: null,
        conflictSolver: null
      };

      const result = PhaseTimingsSchema.parse(input);

      expect(result.implementation).toBeNull();
      expect(result.review).toBe(60000);
      expect(result.merge).toBeNull();
      expect(result.conflictSolver).toBeNull();
    });

    test("accepts partial phase timings", () => {
      const input = {
        implementation: 120000
      };

      const result = PhaseTimingsSchema.parse(input);

      expect(result.implementation).toBe(120000);
      expect(result.review).toBeNull();
    });
  });

  describe("SubtaskTimingSchema", () => {
    test("parses with all timing fields", () => {
      const input = {
        startedAt: "2026-01-25T10:00:00Z",
        completedAt: "2026-01-25T12:00:00Z",
        durationMs: 7200000,
        phases: {
          implementation: 6000000,
          review: 1000000,
          merge: 200000,
          conflictSolver: null
        }
      };

      const result = SubtaskTimingSchema.parse(input);

      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.durationMs).toBe(7200000);
      expect(result.phases.implementation).toBe(6000000);
      expect(result.phases.review).toBe(1000000);
    });

    test("applies null defaults for missing fields", () => {
      const result = SubtaskTimingSchema.parse({});

      expect(result.startedAt).toBeNull();
      expect(result.completedAt).toBeNull();
      expect(result.durationMs).toBeNull();
      expect(result.phases.implementation).toBeNull();
      expect(result.phases.review).toBeNull();
      expect(result.phases.merge).toBeNull();
      expect(result.phases.conflictSolver).toBeNull();
    });

    test("coerces date strings to Date objects", () => {
      const input = {
        startedAt: "2026-01-25T10:00:00Z",
        completedAt: "2026-01-25T12:00:00Z"
      };

      const result = SubtaskTimingSchema.parse(input);

      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.startedAt?.toISOString()).toBe("2026-01-25T10:00:00.000Z");
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.completedAt?.toISOString()).toBe(
        "2026-01-25T12:00:00.000Z"
      );
    });

    test("accepts Date objects directly", () => {
      const startDate = new Date("2026-01-25T10:00:00Z");
      const endDate = new Date("2026-01-25T12:00:00Z");
      const input = {
        startedAt: startDate,
        completedAt: endDate
      };

      const result = SubtaskTimingSchema.parse(input);

      expect(result.startedAt?.getTime()).toBe(startDate.getTime());
      expect(result.completedAt?.getTime()).toBe(endDate.getTime());
    });
  });

  describe("TaskTimingSchema", () => {
    test("parses with all timing fields", () => {
      const input = {
        startedAt: "2026-01-25T08:00:00Z",
        completedAt: "2026-01-25T18:00:00Z",
        durationMs: 36000000
      };

      const result = TaskTimingSchema.parse(input);

      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.durationMs).toBe(36000000);
    });

    test("applies null defaults for missing fields", () => {
      const result = TaskTimingSchema.parse({});

      expect(result.startedAt).toBeNull();
      expect(result.completedAt).toBeNull();
      expect(result.durationMs).toBeNull();
    });

    test("coerces date strings to Date objects", () => {
      const input = {
        startedAt: "2026-01-25T08:00:00Z"
      };

      const result = TaskTimingSchema.parse(input);

      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.startedAt?.toISOString()).toBe("2026-01-25T08:00:00.000Z");
      expect(result.completedAt).toBeNull();
    });
  });
});

describe("Extended Frontmatter Schemas with Timing", () => {
  describe("TaskFrontmatterSchema with timing fields", () => {
    test("parses with timing fields", () => {
      const input = {
        title: "Task with timing",
        status: "INPROGRESS",
        created: "2026-01-25T08:00:00Z",
        priority: "high",
        startedAt: "2026-01-25T08:00:00Z",
        completedAt: "2026-01-25T18:00:00Z",
        durationMs: 36000000
      };

      const result = TaskFrontmatterSchema.parse(input);

      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.durationMs).toBe(36000000);
    });

    test("applies null defaults for timing fields when not provided", () => {
      const input = {
        title: "Task without timing",
        status: "PENDING",
        created: "2026-01-25T08:00:00Z",
        priority: "medium"
      };

      const result = TaskFrontmatterSchema.parse(input);

      expect(result.startedAt).toBeNull();
      expect(result.completedAt).toBeNull();
      expect(result.durationMs).toBeNull();
    });

    test("backward compatible - existing task files without timing still parse", () => {
      const existingTaskFormat = {
        title: "Legacy Task",
        status: "DONE",
        created: "2026-01-20T00:00:00Z",
        priority: "low",
        tags: ["legacy"],
        assignee: "developer",
        dependencies: []
      };

      const result = TaskFrontmatterSchema.parse(existingTaskFormat);

      expect(result.title).toBe("Legacy Task");
      expect(result.status).toBe("DONE");
      expect(result.startedAt).toBeNull();
      expect(result.completedAt).toBeNull();
      expect(result.durationMs).toBeNull();
    });

    test("allows partial timing - only startedAt provided", () => {
      const input = {
        title: "In Progress Task",
        status: "INPROGRESS",
        created: "2026-01-25T08:00:00Z",
        priority: "high",
        startedAt: "2026-01-25T08:00:00Z"
      };

      const result = TaskFrontmatterSchema.parse(input);

      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeNull();
      expect(result.durationMs).toBeNull();
    });
  });

  describe("SubtaskFrontmatterSchema with timing field", () => {
    test("parses with timing object", () => {
      const input = {
        title: "Subtask with timing",
        status: "DONE",
        dependencies: [1],
        timing: {
          startedAt: "2026-01-25T10:00:00Z",
          completedAt: "2026-01-25T12:00:00Z",
          durationMs: 7200000,
          phases: {
            implementation: 6000000,
            review: 1000000,
            merge: 200000,
            conflictSolver: null
          }
        }
      };

      const result = SubtaskFrontmatterSchema.parse(input);

      expect(result.timing).toBeDefined();
      expect(result.timing?.startedAt).toBeInstanceOf(Date);
      expect(result.timing?.completedAt).toBeInstanceOf(Date);
      expect(result.timing?.durationMs).toBe(7200000);
      expect(result.timing?.phases.implementation).toBe(6000000);
    });

    test("applies undefined default for timing when not provided", () => {
      const input = {
        title: "Subtask without timing",
        status: "PENDING",
        dependencies: []
      };

      const result = SubtaskFrontmatterSchema.parse(input);

      expect(result.timing).toBeUndefined();
    });

    test("backward compatible - existing subtask files without timing still parse", () => {
      const existingSubtaskFormat = {
        title: "Legacy Subtask",
        status: "DONE",
        dependencies: [1, 2]
      };

      const result = SubtaskFrontmatterSchema.parse(existingSubtaskFormat);

      expect(result.title).toBe("Legacy Subtask");
      expect(result.status).toBe("DONE");
      expect(result.dependencies).toEqual([1, 2]);
      expect(result.timing).toBeUndefined();
    });

    test("accepts empty timing object with defaults", () => {
      const input = {
        title: "Subtask with empty timing",
        status: "INPROGRESS",
        dependencies: [],
        timing: {}
      };

      const result = SubtaskFrontmatterSchema.parse(input);

      expect(result.timing).toBeDefined();
      expect(result.timing?.startedAt).toBeNull();
      expect(result.timing?.completedAt).toBeNull();
      expect(result.timing?.durationMs).toBeNull();
      expect(result.timing?.phases.implementation).toBeNull();
    });
  });
});

describe("Global Configuration Schemas", () => {
  describe("OperationModeSchema", () => {
    test("accepts valid values", () => {
      const validModes: OperationMode[] = ["local", "global"];
      for (const mode of validModes) {
        expect(OperationModeSchema.parse(mode)).toBe(mode);
      }
    });

    test("rejects invalid values", () => {
      expect(() => OperationModeSchema.parse("hybrid")).toThrow();
      expect(() => OperationModeSchema.parse("")).toThrow();
      expect(() => OperationModeSchema.parse(123)).toThrow();
    });
  });

  describe("ProviderConfigSchema", () => {
    test("parses with all fields", () => {
      const input = {
        model: "claude-3-opus",
        apiKey: "sk-test-key",
        env: {
          CUSTOM_VAR: "value1",
          ANOTHER_VAR: "value2"
        }
      };

      const result = ProviderConfigSchema.parse(input);

      expect(result.model).toBe("claude-3-opus");
      expect(result.apiKey).toBe("sk-test-key");
      expect(result.env).toEqual({
        CUSTOM_VAR: "value1",
        ANOTHER_VAR: "value2"
      });
    });

    test("parses with only model", () => {
      const input = {
        model: "gpt-4"
      };

      const result = ProviderConfigSchema.parse(input);

      expect(result.model).toBe("gpt-4");
      expect(result.apiKey).toBeUndefined();
      expect(result.env).toBeUndefined();
    });

    test("parses with empty object", () => {
      const result = ProviderConfigSchema.parse({});

      expect(result.model).toBeUndefined();
      expect(result.apiKey).toBeUndefined();
      expect(result.env).toBeUndefined();
    });

    test("parses with only env", () => {
      const input = {
        env: { API_ENDPOINT: "https://example.com" }
      };

      const result = ProviderConfigSchema.parse(input);

      expect(result.env).toEqual({ API_ENDPOINT: "https://example.com" });
    });
  });

  describe("GlobalConfigSchema", () => {
    test("parses with all fields", () => {
      const input = {
        version: 1,
        defaults: {
          maxConcurrentAgents: 5,
          debounceMs: 200
        },
        providers: {
          claude: {
            model: "claude-3-opus",
            apiKey: "sk-test"
          },
          openai: {
            model: "gpt-4"
          }
        }
      };

      const result = GlobalConfigSchema.parse(input);

      expect(result.version).toBe(1);
      expect(result.defaults.maxConcurrentAgents).toBe(5);
      expect(result.defaults.debounceMs).toBe(200);
      expect(result.providers.claude?.model).toBe("claude-3-opus");
      expect(result.providers.openai?.model).toBe("gpt-4");
    });

    test("applies default version of 1", () => {
      const input = {
        defaults: {},
        providers: {}
      };

      const result = GlobalConfigSchema.parse(input);

      expect(result.version).toBe(1);
    });

    test("applies empty defaults for missing fields", () => {
      const input = {
        version: 1
      };

      const result = GlobalConfigSchema.parse(input);

      expect(result.defaults).toEqual({});
      expect(result.providers).toEqual({});
    });

    test("parses with partial defaults from ConfigSchema", () => {
      const input = {
        version: 1,
        defaults: {
          maxConcurrentAgents: 10,
          retryBackoff: {
            initialMs: 5000,
            maxMs: 600000,
            maxAttempts: 10
          }
        },
        providers: {}
      };

      const result = GlobalConfigSchema.parse(input);

      expect(result.defaults.maxConcurrentAgents).toBe(10);
      expect(result.defaults.retryBackoff?.initialMs).toBe(5000);
      expect(result.defaults.retryBackoff?.maxMs).toBe(600000);
      expect(result.defaults.retryBackoff?.maxAttempts).toBe(10);
    });

    test("parses empty object with all defaults", () => {
      const result = GlobalConfigSchema.parse({});

      expect(result.version).toBe(1);
      expect(result.defaults).toEqual({});
      expect(result.providers).toEqual({});
    });

    test("validates version is a number", () => {
      expect(() =>
        GlobalConfigSchema.parse({
          version: "1"
        })
      ).toThrow();
    });
  });

  describe("ProjectConfigSchema", () => {
    test("parses with all fields", () => {
      const input = {
        name: "my-project",
        path: "/home/user/projects/my-project",
        gitRemote: "git@github.com:user/my-project.git",
        registered: "2026-01-28T10:00:00Z",
        settings: {
          maxConcurrentAgents: 2,
          dashboardPort: 3001
        },
        providers: {
          claude: {
            apiKey: "project-specific-key"
          }
        }
      };

      const result = ProjectConfigSchema.parse(input);

      expect(result.name).toBe("my-project");
      expect(result.path).toBe("/home/user/projects/my-project");
      expect(result.gitRemote).toBe("git@github.com:user/my-project.git");
      expect(result.registered).toBeInstanceOf(Date);
      expect(result.settings?.maxConcurrentAgents).toBe(2);
      expect(result.providers?.claude?.apiKey).toBe("project-specific-key");
    });

    test("parses with required fields only", () => {
      const input = {
        name: "minimal-project",
        path: "/home/user/minimal",
        gitRemote: null,
        registered: "2026-01-28T10:00:00Z"
      };

      const result = ProjectConfigSchema.parse(input);

      expect(result.name).toBe("minimal-project");
      expect(result.path).toBe("/home/user/minimal");
      expect(result.gitRemote).toBeNull();
      expect(result.registered).toBeInstanceOf(Date);
      expect(result.settings).toBeUndefined();
      expect(result.providers).toBeUndefined();
    });

    test("coerces date from ISO string", () => {
      const input = {
        name: "date-test",
        path: "/test",
        gitRemote: null,
        registered: "2026-06-15T14:30:00Z"
      };

      const result = ProjectConfigSchema.parse(input);

      expect(result.registered).toBeInstanceOf(Date);
      expect(result.registered.toISOString()).toBe("2026-06-15T14:30:00.000Z");
    });

    test("accepts Date object directly for registered", () => {
      const date = new Date("2026-01-28T10:00:00Z");
      const input = {
        name: "date-object-test",
        path: "/test",
        gitRemote: null,
        registered: date
      };

      const result = ProjectConfigSchema.parse(input);

      expect(result.registered.getTime()).toBe(date.getTime());
    });

    test("accepts null gitRemote", () => {
      const input = {
        name: "no-remote",
        path: "/local/project",
        gitRemote: null,
        registered: "2026-01-28T10:00:00Z"
      };

      const result = ProjectConfigSchema.parse(input);

      expect(result.gitRemote).toBeNull();
    });

    test("rejects missing required fields", () => {
      expect(() => ProjectConfigSchema.parse({})).toThrow();
      expect(() =>
        ProjectConfigSchema.parse({
          name: "incomplete"
        })
      ).toThrow();
      expect(() =>
        ProjectConfigSchema.parse({
          name: "incomplete",
          path: "/test"
        })
      ).toThrow();
    });

    test("parses with partial settings - overrides are applied", () => {
      const input = {
        name: "partial-settings",
        path: "/test",
        gitRemote: "https://github.com/user/repo",
        registered: "2026-01-28T10:00:00Z",
        settings: {
          debounceMs: 500
        }
      };

      const result = ProjectConfigSchema.parse(input);

      expect(result.settings?.debounceMs).toBe(500);
    });
  });

  describe("ResolvedPathsSchema", () => {
    test("parses local mode paths", () => {
      const input = {
        mode: "local",
        projectName: "my-project",
        projectRoot: "/home/user/projects/my-project",
        devsfactoryDir: "/home/user/projects/my-project/.devsfactory",
        worktreesDir: "/home/user/projects/my-project/.worktrees",
        brainstormDir: "/home/user/projects/my-project/.devsfactory/brainstorm"
      };

      const result = ResolvedPathsSchema.parse(input);

      expect(result.mode).toBe("local");
      expect(result.projectName).toBe("my-project");
      expect(result.projectRoot).toBe("/home/user/projects/my-project");
      expect(result.devsfactoryDir).toBe(
        "/home/user/projects/my-project/.devsfactory"
      );
      expect(result.worktreesDir).toBe(
        "/home/user/projects/my-project/.worktrees"
      );
      expect(result.brainstormDir).toBe(
        "/home/user/projects/my-project/.devsfactory/brainstorm"
      );
    });

    test("parses global mode paths", () => {
      const input = {
        mode: "global",
        projectName: "my-project",
        projectRoot: "/home/user/projects/my-project",
        devsfactoryDir: "/home/user/.aop/tasks/my-project",
        worktreesDir: "/home/user/.aop/worktrees/my-project",
        brainstormDir: "/home/user/.aop/brainstorm/my-project"
      };

      const result = ResolvedPathsSchema.parse(input);

      expect(result.mode).toBe("global");
      expect(result.projectName).toBe("my-project");
      expect(result.projectRoot).toBe("/home/user/projects/my-project");
      expect(result.devsfactoryDir).toBe("/home/user/.aop/tasks/my-project");
      expect(result.worktreesDir).toBe("/home/user/.aop/worktrees/my-project");
      expect(result.brainstormDir).toBe(
        "/home/user/.aop/brainstorm/my-project"
      );
    });

    test("rejects invalid mode", () => {
      const input = {
        mode: "hybrid",
        projectName: "test",
        projectRoot: "/test",
        devsfactoryDir: "/test/.devsfactory",
        worktreesDir: "/test/.worktrees",
        brainstormDir: "/test/.devsfactory/brainstorm"
      };

      expect(() => ResolvedPathsSchema.parse(input)).toThrow();
    });

    test("rejects missing required fields", () => {
      expect(() => ResolvedPathsSchema.parse({})).toThrow();
      expect(() =>
        ResolvedPathsSchema.parse({
          mode: "local"
        })
      ).toThrow();
      expect(() =>
        ResolvedPathsSchema.parse({
          mode: "local",
          projectName: "test",
          projectRoot: "/test"
        })
      ).toThrow();
    });
  });
});

describe("Global Configuration Type Exports", () => {
  test("exported global config types are correctly inferred", () => {
    const mode: OperationMode = "global";
    const providerConfig: ProviderConfig = {
      model: "claude-3-opus",
      apiKey: "test-key"
    };
    const globalConfig: GlobalConfig = {
      version: 1,
      defaults: { maxConcurrentAgents: 5 },
      providers: { claude: providerConfig }
    };
    const projectConfig: ProjectConfig = {
      name: "test",
      path: "/test",
      gitRemote: null,
      registered: new Date()
    };
    const resolvedPaths: ResolvedPaths = {
      mode: "local",
      projectName: "test",
      projectRoot: "/test",
      devsfactoryDir: "/test/.devsfactory",
      worktreesDir: "/test/.worktrees",
      brainstormDir: "/test/.devsfactory/brainstorm"
    };

    expect(mode).toBe("global");
    expect(providerConfig.model).toBe("claude-3-opus");
    expect(globalConfig.version).toBe(1);
    expect(projectConfig.name).toBe("test");
    expect(resolvedPaths.mode).toBe("local");
  });
});
