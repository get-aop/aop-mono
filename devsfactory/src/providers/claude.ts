import type { CommandOptions, LLMProvider } from "./types";

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";

  buildCommand(options: CommandOptions): string[] {
    return [
      "claude",
      "--print",
      "--dangerously-skip-permissions",
      ...(options.extraArgs ?? []),
      options.prompt
    ];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["claude", "--version"], {
        stdout: "ignore",
        stderr: "ignore"
      });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }
}
