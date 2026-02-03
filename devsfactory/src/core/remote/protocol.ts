import { z } from "zod";
import {
  OrchestratorStateSchema,
  PlanSchema,
  SubtaskSchema,
  TaskSchema
} from "../../types";
import type { Job } from "../types/job";

/**
 * Protocol version for compatibility checking
 */
export const PROTOCOL_VERSION = "1.1.0";

/**
 * Message types sent from server to agent
 */
export const ServerMessageTypeSchema = z.enum([
  "auth:challenge",
  "auth:success",
  "auth:failure",
  "job:assign",
  "job:cancel",
  "heartbeat:ack",
  "state:request",
  "task:create",
  "error"
]);

/**
 * Message types sent from agent to server
 */
export const AgentMessageTypeSchema = z.enum([
  "auth:hello",
  "auth:response",
  "job:accepted",
  "job:output",
  "job:completed",
  "job:failed",
  "heartbeat",
  "status:update",
  "state:snapshot",
  "state:delta"
]);

export type ServerMessageType = z.infer<typeof ServerMessageTypeSchema>;
export type AgentMessageType = z.infer<typeof AgentMessageTypeSchema>;

/**
 * Agent status
 */
export const AgentStatusSchema = z.enum(["idle", "busy", "disconnecting"]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Remote agent information tracked by the server
 */
export interface RemoteAgentInfo {
  agentId: string;
  clientId: string;
  machineId: string;
  projectName?: string;
  status: AgentStatus;
  currentJob?: JobAssignment;
  connectedAt: Date;
  lastHeartbeat: Date;
  capabilities?: AgentCapabilities;
}

/**
 * Agent capabilities reported during handshake
 */
export interface AgentCapabilities {
  maxConcurrentJobs: number;
  supportedModels: string[];
  claudeVersion?: string;
  hasLocalStorage: boolean;
}

/**
 * Job assignment sent to an agent
 */
export interface JobAssignment {
  jobId: string;
  job: Job;
  prompt: string;
  cwd: string;
  model?: string;
  timeout?: number;
  systemPrompt?: string;
}

// ============================================================
// Server -> Agent Messages
// ============================================================

/**
 * Authentication challenge sent to agent on connection
 */
export const AuthChallengeMessageSchema = z.object({
  type: z.literal("auth:challenge"),
  challenge: z.string(),
  timestamp: z.number()
});
export type AuthChallengeMessage = z.infer<typeof AuthChallengeMessageSchema>;

/**
 * Authentication success response
 */
export const AuthSuccessMessageSchema = z.object({
  type: z.literal("auth:success"),
  agentId: z.string(),
  serverVersion: z.string()
});
export type AuthSuccessMessage = z.infer<typeof AuthSuccessMessageSchema>;

/**
 * Authentication failure response
 */
export const AuthFailureMessageSchema = z.object({
  type: z.literal("auth:failure"),
  reason: z.string()
});
export type AuthFailureMessage = z.infer<typeof AuthFailureMessageSchema>;

/**
 * Job assignment message (lightweight - client generates prompt locally)
 */
export const JobAssignMessageSchema = z.object({
  type: z.literal("job:assign"),
  jobId: z.string(),
  job: z.object({
    type: z.string(),
    taskFolder: z.string(),
    projectName: z.string().optional(),
    subtaskFile: z.string().optional(),
    priority: z.number().optional()
  }),
  paths: z.object({
    devsfactoryDir: z.string(),
    worktreeCwd: z.string()
  }),
  model: z.string().optional(),
  timeout: z.number().optional(),
  systemPrompt: z.string().optional()
});
export type JobAssignMessage = z.infer<typeof JobAssignMessageSchema>;

/**
 * Job cancellation message
 */
export const JobCancelMessageSchema = z.object({
  type: z.literal("job:cancel"),
  jobId: z.string(),
  reason: z.string().optional()
});
export type JobCancelMessage = z.infer<typeof JobCancelMessageSchema>;

/**
 * Heartbeat acknowledgment
 */
export const HeartbeatAckMessageSchema = z.object({
  type: z.literal("heartbeat:ack"),
  serverTime: z.number()
});
export type HeartbeatAckMessage = z.infer<typeof HeartbeatAckMessageSchema>;

/**
 * Error message from server
 */
export const ServerErrorMessageSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  jobId: z.string().optional()
});
export type ServerErrorMessage = z.infer<typeof ServerErrorMessageSchema>;

/**
 * Request a full state snapshot for a project
 */
export const StateRequestMessageSchema = z.object({
  type: z.literal("state:request"),
  projectName: z.string()
});
export type StateRequestMessage = z.infer<typeof StateRequestMessageSchema>;

/**
 * Request task creation on an agent
 */
export const TaskCreateMessageSchema = z.object({
  type: z.literal("task:create"),
  projectName: z.string(),
  task: TaskSchema,
  subtasks: z.array(SubtaskSchema).optional()
});
export type TaskCreateMessage = z.infer<typeof TaskCreateMessageSchema>;

/**
 * Union of all server message types
 */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  AuthChallengeMessageSchema,
  AuthSuccessMessageSchema,
  AuthFailureMessageSchema,
  JobAssignMessageSchema,
  JobCancelMessageSchema,
  HeartbeatAckMessageSchema,
  StateRequestMessageSchema,
  TaskCreateMessageSchema,
  ServerErrorMessageSchema
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ============================================================
// Agent -> Server Messages
// ============================================================

/**
 * Agent hello message (initial connection)
 */
export const AuthHelloMessageSchema = z.object({
  type: z.literal("auth:hello"),
  clientId: z.string(),
  machineId: z.string(),
  projectName: z.string(),
  protocolVersion: z.string(),
  capabilities: z.object({
    maxConcurrentJobs: z.number().default(1),
    supportedModels: z.array(z.string()).default(["opus", "sonnet", "haiku"]),
    claudeVersion: z.string().optional(),
    hasLocalStorage: z.boolean()
  })
});
export type AuthHelloMessage = z.infer<typeof AuthHelloMessageSchema>;

/**
 * Agent authentication response (HMAC signature)
 */
export const AuthResponseMessageSchema = z.object({
  type: z.literal("auth:response"),
  signature: z.string(),
  timestamp: z.number()
});
export type AuthResponseMessage = z.infer<typeof AuthResponseMessageSchema>;

/**
 * Job accepted acknowledgment
 */
export const JobAcceptedMessageSchema = z.object({
  type: z.literal("job:accepted"),
  jobId: z.string()
});
export type JobAcceptedMessage = z.infer<typeof JobAcceptedMessageSchema>;

/**
 * Job output streaming
 */
export const JobOutputMessageSchema = z.object({
  type: z.literal("job:output"),
  jobId: z.string(),
  line: z.string(),
  timestamp: z.number()
});
export type JobOutputMessage = z.infer<typeof JobOutputMessageSchema>;

/**
 * Job completion message
 */
export const JobCompletedMessageSchema = z.object({
  type: z.literal("job:completed"),
  jobId: z.string(),
  exitCode: z.number(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalCostUsd: z.number()
    })
    .optional()
});
export type JobCompletedMessage = z.infer<typeof JobCompletedMessageSchema>;

/**
 * Job failure message
 */
export const JobFailedMessageSchema = z.object({
  type: z.literal("job:failed"),
  jobId: z.string(),
  error: z.string(),
  exitCode: z.number().optional()
});
export type JobFailedMessage = z.infer<typeof JobFailedMessageSchema>;

/**
 * Agent heartbeat with status
 */
export const HeartbeatMessageSchema = z.object({
  type: z.literal("heartbeat"),
  status: AgentStatusSchema,
  currentJobId: z.string().optional(),
  timestamp: z.number()
});
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>;

/**
 * Status update from client to server (v2 protocol)
 */
export const StatusUpdateMessageSchema = z.object({
  type: z.literal("status:update"),
  taskFolder: z.string(),
  subtaskFile: z.string().optional(),
  status: z.string(),
  timestamp: z.number()
});
export type StatusUpdateMessage = z.infer<typeof StatusUpdateMessageSchema>;

/**
 * Full state snapshot from agent
 */
export const StateSnapshotMessageSchema = z.object({
  type: z.literal("state:snapshot"),
  projectName: z.string(),
  state: OrchestratorStateSchema,
  timestamp: z.number()
});
export type StateSnapshotMessage = z.infer<typeof StateSnapshotMessageSchema>;

/**
 * Delta updates from agent
 */
export const StateDeltaUpdateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task:upsert"),
    task: TaskSchema
  }),
  z.object({
    type: z.literal("task:delete"),
    taskFolder: z.string()
  }),
  z.object({
    type: z.literal("plan:upsert"),
    plan: PlanSchema
  }),
  z.object({
    type: z.literal("plan:delete"),
    taskFolder: z.string()
  }),
  z.object({
    type: z.literal("subtask:upsert"),
    taskFolder: z.string(),
    subtask: SubtaskSchema
  }),
  z.object({
    type: z.literal("subtask:delete"),
    taskFolder: z.string(),
    filename: z.string()
  }),
  z.object({
    type: z.literal("subtask:list:replace"),
    taskFolder: z.string(),
    subtasks: z.array(SubtaskSchema)
  })
]);
export type StateDeltaUpdate = z.infer<typeof StateDeltaUpdateSchema>;

export const StateDeltaMessageSchema = z.object({
  type: z.literal("state:delta"),
  projectName: z.string(),
  updates: z.array(StateDeltaUpdateSchema),
  timestamp: z.number()
});
export type StateDeltaMessage = z.infer<typeof StateDeltaMessageSchema>;

/**
 * Union of all agent message types
 */
export const AgentMessageSchema = z.discriminatedUnion("type", [
  AuthHelloMessageSchema,
  AuthResponseMessageSchema,
  JobAcceptedMessageSchema,
  JobOutputMessageSchema,
  JobCompletedMessageSchema,
  JobFailedMessageSchema,
  HeartbeatMessageSchema,
  StatusUpdateMessageSchema,
  StateSnapshotMessageSchema,
  StateDeltaMessageSchema
]);
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

// ============================================================
// Message Validation Helpers
// ============================================================

/**
 * Parse and validate a server message
 */
export const parseServerMessage = (
  data: unknown
):
  | { success: true; message: ServerMessage }
  | { success: false; error: string } => {
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    const result = ServerMessageSchema.safeParse(parsed);
    if (result.success) {
      return { success: true, message: result.data };
    }
    return { success: false, error: result.error.message };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
};

/**
 * Parse and validate an agent message
 */
export const parseAgentMessage = (
  data: unknown
):
  | { success: true; message: AgentMessage }
  | { success: false; error: string } => {
  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    const result = AgentMessageSchema.safeParse(parsed);
    if (result.success) {
      return { success: true, message: result.data };
    }
    return { success: false, error: result.error.message };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
};

/**
 * Serialize a message for sending over WebSocket
 */
export const serializeMessage = (
  message: ServerMessage | AgentMessage
): string => {
  return JSON.stringify(message);
};
