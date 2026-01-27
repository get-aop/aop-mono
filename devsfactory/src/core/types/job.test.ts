import { describe, expect, test } from "bun:test";
import {
  getJobKey,
  type Job,
  JobResultSchema,
  JobSchema,
  JobStatusSchema,
  JobTypeSchema
} from "./job";

describe("JobType", () => {
  test("includes all agent types", () => {
    const validTypes = [
      "implementation",
      "review",
      "completing-task",
      "completion-review",
      "merge",
      "conflict-solver"
    ];
    for (const type of validTypes) {
      expect(JobTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  test("rejects invalid job types", () => {
    expect(JobTypeSchema.safeParse("invalid").success).toBe(false);
    expect(JobTypeSchema.safeParse("planning").success).toBe(false);
  });
});

describe("JobStatus", () => {
  test("includes all valid statuses", () => {
    const validStatuses = ["pending", "running", "completed", "failed"];
    for (const status of validStatuses) {
      expect(JobStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  test("rejects invalid statuses", () => {
    expect(JobStatusSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("Job", () => {
  test("parses valid job with required fields", () => {
    const job = {
      id: "job-123",
      type: "implementation",
      taskFolder: "my-task",
      createdAt: new Date()
    };
    const result = JobSchema.safeParse(job);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("pending");
    }
  });

  test("parses job with subtaskFile", () => {
    const job = {
      id: "job-456",
      type: "review",
      taskFolder: "my-task",
      subtaskFile: "001-first-subtask.md",
      createdAt: new Date()
    };
    const result = JobSchema.safeParse(job);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.subtaskFile).toBe("001-first-subtask.md");
    }
  });

  test("parses job with priority", () => {
    const job = {
      id: "job-789",
      type: "merge",
      taskFolder: "task-a",
      priority: 10,
      createdAt: new Date()
    };
    const result = JobSchema.safeParse(job);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(10);
    }
  });

  test("defaults priority to 0", () => {
    const job = {
      id: "job-abc",
      type: "implementation",
      taskFolder: "task-b",
      createdAt: new Date()
    };
    const result = JobSchema.safeParse(job);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(0);
    }
  });

  test("rejects job with invalid type", () => {
    const job = {
      id: "job-bad",
      type: "invalid-type",
      taskFolder: "task-c",
      createdAt: new Date()
    };
    expect(JobSchema.safeParse(job).success).toBe(false);
  });
});

describe("JobResult", () => {
  test("parses successful result", () => {
    const result = {
      jobId: "job-123",
      success: true
    };
    const parsed = JobResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  test("parses failed result with error", () => {
    const result = {
      jobId: "job-456",
      success: false,
      error: "Something went wrong"
    };
    const parsed = JobResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error).toBe("Something went wrong");
    }
  });
});

describe("getJobKey", () => {
  test("returns key for job without subtask", () => {
    const job: Job = {
      id: "job-1",
      type: "merge",
      taskFolder: "task-alpha",
      status: "pending",
      priority: 0,
      createdAt: new Date()
    };
    expect(getJobKey(job)).toBe("merge:task-alpha");
  });

  test("returns key for job with subtask", () => {
    const job: Job = {
      id: "job-2",
      type: "implementation",
      taskFolder: "task-beta",
      subtaskFile: "002-second.md",
      status: "pending",
      priority: 0,
      createdAt: new Date()
    };
    expect(getJobKey(job)).toBe("implementation:task-beta:002-second.md");
  });

  test("same job params produce same key for deduplication", () => {
    const job1: Job = {
      id: "job-a",
      type: "review",
      taskFolder: "task-x",
      subtaskFile: "001-sub.md",
      status: "pending",
      priority: 0,
      createdAt: new Date()
    };
    const job2: Job = {
      id: "job-b",
      type: "review",
      taskFolder: "task-x",
      subtaskFile: "001-sub.md",
      status: "running",
      priority: 5,
      createdAt: new Date()
    };
    expect(getJobKey(job1)).toBe(getJobKey(job2));
  });
});
