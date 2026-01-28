import { describe, expect, test } from "bun:test";
import type { OrchestratorState } from "../../types";
import { MemoryQueue } from "../local/memory-queue";
import { MemoryAgentRegistry } from "../local/memory-registry";
import { JOB_PRIORITY } from "../types/job";
import { JobProducer } from "./job-producer";

const createEmptyState = (): OrchestratorState => ({
  tasks: [],
  plans: {},
  subtasks: {}
});

describe("JobProducer", () => {
  describe("produceFromState", () => {
    test("enqueues implementation job for PENDING subtask with satisfied dependencies", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "PENDING",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(1);
      const job = await queue.peek();
      expect(job?.type).toBe("implementation");
      expect(job?.taskFolder).toBe("my-task");
      expect(job?.subtaskFile).toBe("001-first.md");
    });

    test("does not enqueue implementation job for PENDING subtask with unsatisfied dependencies", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "PENDING",
                dependencies: []
              },
              description: ""
            },
            {
              filename: "002-second.md",
              number: 2,
              slug: "second",
              frontmatter: {
                title: "Second Subtask",
                status: "PENDING",
                dependencies: [1]
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(1);
      const job = await queue.peek();
      expect(job?.subtaskFile).toBe("001-first.md");
    });

    test("enqueues implementation job for INPROGRESS subtask without running agent (recovery)", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "INPROGRESS",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(1);
      const job = await queue.peek();
      expect(job?.type).toBe("implementation");
      expect(job?.subtaskFile).toBe("001-first.md");
    });

    test("does not enqueue implementation job for INPROGRESS subtask with running agent", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      await registry.register({
        jobId: "existing-job",
        type: "implementation",
        taskFolder: "my-task",
        subtaskFile: "001-first.md",
        pid: 1234,
        startedAt: new Date()
      });

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "INPROGRESS",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(0);
    });

    test("enqueues review job for AGENT_REVIEW subtask", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "AGENT_REVIEW",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(1);
      const job = await queue.peek();
      expect(job?.type).toBe("review");
      expect(job?.subtaskFile).toBe("001-first.md");
    });

    test("does not enqueue review job for AGENT_REVIEW subtask with running review agent", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      await registry.register({
        jobId: "existing-job",
        type: "review",
        taskFolder: "my-task",
        subtaskFile: "001-first.md",
        pid: 1234,
        startedAt: new Date()
      });

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "AGENT_REVIEW",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(0);
    });

    test("enqueues merge job for PENDING_MERGE subtask", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "PENDING_MERGE",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(1);
      const job = await queue.peek();
      expect(job?.type).toBe("merge");
      expect(job?.subtaskFile).toBe("001-first.md");
    });

    test("enqueues conflict-solver job for MERGE_CONFLICT subtask", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "MERGE_CONFLICT",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(1);
      const job = await queue.peek();
      expect(job?.type).toBe("conflict-solver");
      expect(job?.subtaskFile).toBe("001-first.md");
    });

    test("does not enqueue conflict-solver job if agent already running", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      await registry.register({
        jobId: "existing-job",
        type: "conflict-solver",
        taskFolder: "my-task",
        subtaskFile: "001-first.md",
        pid: 1234,
        startedAt: new Date()
      });

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "MERGE_CONFLICT",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(0);
    });

    test("does not enqueue merge job for DONE subtask", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "DONE",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(0);
    });

    test("enqueues completing-task job when all subtasks DONE and plan INPROGRESS", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        plans: {
          "my-task": {
            folder: "my-task",
            frontmatter: {
              status: "INPROGRESS",
              task: "my-task",
              created: new Date()
            },
            subtasks: [
              { number: 1, slug: "first", title: "First", dependencies: [] }
            ]
          }
        },
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "DONE",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      const jobs: string[] = [];
      while ((await queue.size()) > 0) {
        const job = await queue.dequeue();
        if (job) jobs.push(job.type);
      }
      expect(jobs).toContain("completing-task");
    });

    test("enqueues completion-review job when plan AGENT_REVIEW", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        plans: {
          "my-task": {
            folder: "my-task",
            frontmatter: {
              status: "AGENT_REVIEW",
              task: "my-task",
              created: new Date()
            },
            subtasks: [
              { number: 1, slug: "first", title: "First", dependencies: [] }
            ]
          }
        },
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "DONE",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      const jobs: string[] = [];
      while ((await queue.size()) > 0) {
        const job = await queue.dequeue();
        if (job) jobs.push(job.type);
      }
      expect(jobs).toContain("completion-review");
    });

    test("does not enqueue completing-task job if agent already running", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      await registry.register({
        jobId: "existing-job",
        type: "completing-task",
        taskFolder: "my-task",
        pid: 1234,
        startedAt: new Date()
      });

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        plans: {
          "my-task": {
            folder: "my-task",
            frontmatter: {
              status: "INPROGRESS",
              task: "my-task",
              created: new Date()
            },
            subtasks: [
              { number: 1, slug: "first", title: "First", dependencies: [] }
            ]
          }
        },
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "DONE",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      const jobs: string[] = [];
      while ((await queue.size()) > 0) {
        const job = await queue.dequeue();
        if (job) jobs.push(job.type);
      }
      expect(jobs).not.toContain("completing-task");
    });
  });

  describe("idempotency", () => {
    test("does not enqueue duplicate jobs when called multiple times", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "PENDING",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);
      await producer.produceFromState(state);
      await producer.produceFromState(state);

      expect(await queue.size()).toBe(1);
    });

    test("uses queue.has() for deduplication", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "PENDING",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);
      const key = "implementation:my-task:001-first.md";
      expect(await queue.has(key)).toBe(true);
    });
  });

  describe("task filtering", () => {
    test("ignores subtasks for tasks not INPROGRESS", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "pending-task",
            frontmatter: {
              title: "Pending Task",
              status: "PENDING",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          },
          {
            folder: "done-task",
            frontmatter: {
              title: "Done Task",
              status: "DONE",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "pending-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "PENDING",
                dependencies: []
              },
              description: ""
            }
          ],
          "done-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "PENDING",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      expect(await queue.size()).toBe(0);
    });
  });

  describe("job priority", () => {
    test("implementation jobs have priority 10", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "PENDING",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      const job = await queue.peek();
      expect(job?.type).toBe("implementation");
      expect(job?.priority).toBe(JOB_PRIORITY["implementation"]);
      expect(job?.priority).toBe(10);
    });

    test("review jobs have priority 20", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "AGENT_REVIEW",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      const job = await queue.peek();
      expect(job?.type).toBe("review");
      expect(job?.priority).toBe(JOB_PRIORITY["review"]);
      expect(job?.priority).toBe(20);
    });

    test("merge jobs have priority 30", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "PENDING_MERGE",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      const job = await queue.peek();
      expect(job?.type).toBe("merge");
      expect(job?.priority).toBe(JOB_PRIORITY["merge"]);
      expect(job?.priority).toBe(30);
    });

    test("conflict-solver jobs have priority 40", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "MERGE_CONFLICT",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      const job = await queue.peek();
      expect(job?.type).toBe("conflict-solver");
      expect(job?.priority).toBe(JOB_PRIORITY["conflict-solver"]);
      expect(job?.priority).toBe(40);
    });

    test("completing-task jobs have priority 15", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        plans: {
          "my-task": {
            folder: "my-task",
            frontmatter: {
              status: "INPROGRESS",
              task: "my-task",
              created: new Date()
            },
            subtasks: [
              { number: 1, slug: "first", title: "First", dependencies: [] }
            ]
          }
        },
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "DONE",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      const job = await queue.dequeue();
      expect(job?.type).toBe("completing-task");
      expect(job?.priority).toBe(JOB_PRIORITY["completing-task"]);
      expect(job?.priority).toBe(15);
    });

    test("completion-review jobs have priority 25", async () => {
      const queue = new MemoryQueue();
      const registry = new MemoryAgentRegistry();
      const producer = new JobProducer(queue, registry);

      const state: OrchestratorState = {
        ...createEmptyState(),
        tasks: [
          {
            folder: "my-task",
            frontmatter: {
              title: "My Task",
              status: "INPROGRESS",
              created: new Date(),
              priority: "medium",
              tags: [],
              assignee: null,
              dependencies: [],
              startedAt: null,
              completedAt: null,
              durationMs: null
            },
            description: "",
            requirements: "",
            acceptanceCriteria: []
          }
        ],
        plans: {
          "my-task": {
            folder: "my-task",
            frontmatter: {
              status: "AGENT_REVIEW",
              task: "my-task",
              created: new Date()
            },
            subtasks: [
              { number: 1, slug: "first", title: "First", dependencies: [] }
            ]
          }
        },
        subtasks: {
          "my-task": [
            {
              filename: "001-first.md",
              number: 1,
              slug: "first",
              frontmatter: {
                title: "First Subtask",
                status: "DONE",
                dependencies: []
              },
              description: ""
            }
          ]
        }
      };

      await producer.produceFromState(state);

      const job = await queue.dequeue();
      expect(job?.type).toBe("completion-review");
      expect(job?.priority).toBe(JOB_PRIORITY["completion-review"]);
      expect(job?.priority).toBe(25);
    });
  });
});
