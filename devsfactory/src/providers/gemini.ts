import type { CommandOptions, LLMProvider } from "./types";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

  buildCommand(options: CommandOptions): string[] {
    return ["gemini", ...(options.extraArgs ?? []), "-p", options.prompt];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["gemini", "--version"], {
        stdout: "ignore",
        stderr: "ignore"
      });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }
}
