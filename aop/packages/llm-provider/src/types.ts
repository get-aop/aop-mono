import type { OutputHandler } from "@aop/infra";

export interface RunOptions {
  prompt: string;
  cwd?: string;
  resumeSessionId?: string;
  onOutput?: OutputHandler;
  /** Called when stream activity occurs, useful for timeout tracking */
  onActivity?: () => void;
  /** Timeout in milliseconds for inactivity. Process killed if no output for this duration. */
  inactivityTimeoutMs?: number;
}

export interface RunResult {
  exitCode: number;
  sessionId?: string;
  /** True if the process was killed due to inactivity timeout */
  timedOut?: boolean;
}

export interface LLMProvider {
  readonly name: string;
  run(options: RunOptions): Promise<RunResult>;
}
