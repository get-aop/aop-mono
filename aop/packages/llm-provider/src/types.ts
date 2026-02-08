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
  /** Called immediately after the process is spawned with its PID */
  onSpawn?: (pid: number) => void;
  /** Environment variables to merge with process.env when spawning */
  env?: Record<string, string>;
  /** Path to a file where stdout should be redirected instead of piped */
  logFilePath?: string;
}

export interface RunResult {
  exitCode: number;
  pid?: number;
  sessionId?: string;
  /** True if the process was killed due to inactivity timeout */
  timedOut?: boolean;
}

export interface LLMProvider {
  readonly name: string;
  run(options: RunOptions): Promise<RunResult>;
}
