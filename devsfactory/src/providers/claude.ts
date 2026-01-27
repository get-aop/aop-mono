import type { CommandOptions, LLMProvider } from "./types";

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";

  buildCommand(options: CommandOptions): string[] {
    return [
      "claude",
      "--output-format",
      "stream-json",
      "--verbose",
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

export const parseStreamJson = (line: string): string | null => {
  try {
    const data = JSON.parse(line);

    // Handle assistant messages (Claude's output)
    if (data.type === "assistant" && data.message?.content) {
      const parts: string[] = [];
      for (const item of data.message.content) {
        if (item.type === "text" && item.text) {
          parts.push(item.text);
        } else if (item.type === "tool_use") {
          const input = item.input || {};
          // Show tool name and key info
          if (item.name === "Read") {
            const path = input.file_path?.split("/").slice(-2).join("/") || "";
            parts.push(`[Read: ${path}]`);
          } else if (item.name === "Write") {
            const path = input.file_path?.split("/").slice(-2).join("/") || "";
            parts.push(`[Write: ${path}]`);
          } else if (item.name === "Edit") {
            const path = input.file_path?.split("/").slice(-2).join("/") || "";
            parts.push(`[Edit: ${path}]`);
          } else if (item.name === "Bash") {
            const cmd = input.command?.slice(0, 60) || "";
            parts.push(`[Bash: ${cmd}${cmd.length >= 60 ? "..." : ""}]`);
          } else if (item.name === "Glob" || item.name === "Grep") {
            const pattern = input.pattern?.slice(0, 40) || "";
            parts.push(`[${item.name}: ${pattern}]`);
          } else {
            parts.push(`[${item.name}]`);
          }
        }
      }
      if (parts.length > 0) {
        return parts.join(" ");
      }
    }

    // Handle result messages - just show brief status
    if (data.type === "result") {
      const cost = data.cost_usd ? `$${data.cost_usd.toFixed(4)}` : "";
      return `── Result: ${data.subtype || "done"} ${cost}`;
    }

    // Skip user messages (tool results) - they're verbose
    if (data.type === "user") {
      return null;
    }

    // Skip system messages
    if (data.type === "system") {
      return null;
    }

    return null;
  } catch {
    // Not JSON, return as-is
    return line;
  }
};
