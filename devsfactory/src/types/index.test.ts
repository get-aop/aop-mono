import { describe, expect, test } from "bun:test";
import {
  AgentProcessSchema,
  type AgentType,
  AgentTypeSchema,
  ConfigSchema,
  OrchestratorStateSchema,
  PhaseTimingsSchema,
  PlanFrontmatterSchema,
  PlanSchema,
  type PlanStatus,
  PlanStatusSchema,
  type Priority,
  PrioritySchema,
  SubtaskFrontmatterSchema,
  SubtaskReferenceSchema,
  SubtaskSchema,
  type SubtaskStatus,
  SubtaskStatusSchema,
  SubtaskTimingSchema,
  TaskFrontmatterSchema,
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

      expect(result.maxConcurrentAgents).toBe(3);
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
