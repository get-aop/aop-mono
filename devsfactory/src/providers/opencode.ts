import type { CommandOptions, LLMProvider } from "./types";

export class OpenCodeProvider implements LLMProvider {
  readonly name = "opencode";

  buildCommand(options: CommandOptions): string[] {
    return ["opencode", ...(options.extraArgs ?? []), "run", options.prompt];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["opencode", "--version"], {
        stdout: "ignore",
        stderr: "ignore"
      });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }
}
