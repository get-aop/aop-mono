import { EventEmitter } from "node:events";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import KSUID from "ksuid";
import type { AgentProcess, AgentType } from "../types";

export interface SpawnOptions {
  type: AgentType;
  taskFolder: string;
  subtaskFile?: string;
  prompt: string;
  cwd: string;
  command: string[];
  logsDir?: string;
}

interface RunningProcess {
  agentProcess: AgentProcess;
  subprocess: ReturnType<typeof Bun.spawn>;
  logFile?: Awaited<ReturnType<typeof open>>;
}

export class AgentRunner extends EventEmitter {
  private processes: Map<string, RunningProcess> = new Map();

  async spawn(options: SpawnOptions): Promise<AgentProcess> {
    const id = this.generateId();
    const startedAt = new Date();

    const subprocess = Bun.spawn(options.command, {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe"
    });

    const agentProcess: AgentProcess = {
      id,
      type: options.type,
      taskFolder: options.taskFolder,
      subtaskFile: options.subtaskFile,
      pid: subprocess.pid,
      startedAt
    };

    let logFile: Awaited<ReturnType<typeof open>> | undefined;
    if (options.logsDir) {
      const logPath = join(options.logsDir, `${id}.log`);
      await mkdir(dirname(logPath), { recursive: true });
      logFile = await open(logPath, "a");
    }

    this.processes.set(id, { agentProcess, subprocess, logFile });
    this.emit("started", { agentId: id, process: agentProcess });

    this.handleProcessOutput(id, subprocess, logFile);

    return agentProcess;
  }

  async kill(agentId: string): Promise<void> {
    const running = this.processes.get(agentId);
    if (!running) return;

    const { subprocess } = running;

    // Remove from tracking immediately
    this.processes.delete(agentId);

    // Send SIGTERM first
    subprocess.kill("SIGTERM");

    // Wait up to 500ms for graceful shutdown
    const timeout = 500;
    const start = Date.now();

    while (subprocess.exitCode === null && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // If still running, force kill
    if (subprocess.exitCode === null) {
      subprocess.kill("SIGKILL");
    }
  }

  getActive(): AgentProcess[] {
    return Array.from(this.processes.values()).map((p) => p.agentProcess);
  }

  getCountByType(type: AgentType): number {
    return this.getActive().filter((p) => p.type === type).length;
  }

  private generateId(): string {
    return `agent-${KSUID.randomSync().string}`;
  }

  private handleProcessOutput(
    agentId: string,
    subprocess: ReturnType<typeof Bun.spawn>,
    logFile?: Awaited<ReturnType<typeof open>>
  ): void {
    const encoder = new TextEncoder();

    const emitLines = async (stream: ReadableStream<Uint8Array> | null) => {
      if (!stream) return;

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim()) {
              this.emit("output", { agentId, line: line.trim() });
              if (logFile) {
                await logFile.write(encoder.encode(`${line}\n`));
              }
            }
          }
        }

        // Emit remaining buffer
        if (buffer.trim()) {
          this.emit("output", { agentId, line: buffer.trim() });
          if (logFile) {
            await logFile.write(encoder.encode(`${buffer.trim()}\n`));
          }
        }
      } catch (error) {
        this.emit("error", { agentId, error });
      }
    };

    // Handle both stdout and stderr (cast to handle Bun's type union)
    const stdout = subprocess.stdout as ReadableStream<Uint8Array> | null;
    const stderr = subprocess.stderr as ReadableStream<Uint8Array> | null;
    Promise.all([emitLines(stdout), emitLines(stderr)]).then(async () => {
      if (logFile) {
        await logFile.close();
      }
      // Wait for process to fully exit
      subprocess.exited.then((exitCode) => {
        this.processes.delete(agentId);
        this.emit("completed", { agentId, exitCode });
      });
    });
  }
}
