# Multi-LLM Provider Support Design

## Overview

Enable devsfactory to work with multiple CLI-based LLM tools, allowing users to choose their preferred provider. Initial support targets three CLIs:

- **Claude Code** (`claude`) - current default
- **OpenCode** (`opencode`)
- **Gemini CLI** (`gemini`)

## Design Principle

Simple adapter pattern with minimal abstraction. Providers are command builders - they produce the `string[]` command array that AgentRunner spawns.

## CLI Comparison

| Aspect | Claude Code | OpenCode | Gemini CLI |
|--------|-------------|----------|------------|
| Command | `claude` | `opencode` | `gemini` |
| Non-interactive prompt | `--print "prompt"` | `run "prompt"` | `-p "prompt"` |
| Working directory | Uses cwd | Uses cwd | Uses cwd |

## Provider Interface

```typescript
// src/providers/types.ts

export interface CommandOptions {
  prompt: string;
  cwd: string;
}

export interface LLMProvider {
  readonly name: string;
  buildCommand(options: CommandOptions): string[];
  isAvailable(): Promise<boolean>;
}
```

## Provider Implementations

```typescript
// src/providers/claude.ts
export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";

  buildCommand(options: CommandOptions): string[] {
    return ["claude", "--print", options.prompt];
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

// src/providers/opencode.ts
export class OpenCodeProvider implements LLMProvider {
  readonly name = "opencode";

  buildCommand(options: CommandOptions): string[] {
    return ["opencode", "run", options.prompt];
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

// src/providers/gemini.ts
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

  buildCommand(options: CommandOptions): string[] {
    return ["gemini", "-p", options.prompt];
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
```

## Factory

```typescript
// src/providers/index.ts

import { ClaudeProvider } from "./claude";
import { OpenCodeProvider } from "./opencode";
import { GeminiProvider } from "./gemini";
import type { LLMProvider } from "./types";

const providers = {
  claude: () => new ClaudeProvider(),
  opencode: () => new OpenCodeProvider(),
  gemini: () => new GeminiProvider(),
} as const;

export type ProviderName = keyof typeof providers;

export function createProvider(name: ProviderName): LLMProvider {
  const factory = providers[name];
  if (!factory) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return factory();
}

export { type LLMProvider, type CommandOptions } from "./types";
```

## Configuration

Add `provider` field to ConfigSchema in `src/types/index.ts`:

```typescript
export const ConfigSchema = z.object({
  maxConcurrentAgents: z.number().default(3),
  devsfactoryDir: z.string().default(".devsfactory"),
  worktreesDir: z.string().default(".worktrees"),
  provider: z.enum(["claude", "opencode", "gemini"]).default("claude"),
});
```

## Integration with AgentRunner

AgentRunner already accepts `command: string[]` in SpawnOptions. The orchestrator uses the provider to build the command:

```typescript
// In orchestrator or wherever agents are spawned
const provider = createProvider(config.provider);

const command = provider.buildCommand({
  prompt: buildPrompt(task, agentType),
  cwd: worktreePath
});

await agentRunner.spawn({
  type: "implementation",
  taskFolder,
  subtaskFile,
  prompt,
  cwd: worktreePath,
  command,
});
```

AgentRunner remains unchanged - it handles process spawning, output streaming, and events.

## Startup Validation

Verify provider is installed before running:

```typescript
async function validateProvider(config: Config): Promise<void> {
  const provider = createProvider(config.provider);

  if (!await provider.isAvailable()) {
    throw new Error(
      `Provider "${config.provider}" is not available. ` +
      `Install it or choose a different provider in config.`
    );
  }
}
```

## File Structure

```
src/
├── providers/
│   ├── index.ts        # createProvider factory + re-exports
│   ├── types.ts        # LLMProvider interface
│   ├── claude.ts       # ClaudeProvider
│   ├── opencode.ts     # OpenCodeProvider
│   ├── gemini.ts       # GeminiProvider
│   └── mock.ts         # MockProvider (for tests)
├── types/
│   └── index.ts        # ConfigSchema with provider field
```

## Testing

MockProvider for unit tests:

```typescript
// src/providers/mock.ts
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  public lastOptions: CommandOptions | null = null;

  buildCommand(options: CommandOptions): string[] {
    this.lastOptions = options;
    return ["echo", "mock response"];
  }

  async isAvailable() {
    return true;
  }
}
```

## Changes to Existing Tasks

| Task | Change |
|------|--------|
| types-and-frontmatter | Add `provider` to ConfigSchema |
| watcher-and-orchestrator | Use provider.buildCommand() when spawning |
| entry-and-skill | Validate provider on startup |

## Future Extensibility (Not in Scope)

- Add new provider: create one file, add to factory map
- Per-agent provider selection (cheaper model for planning)
- Provider-specific config (model overrides, API keys for hybrid CLI/API)

## References

- [OpenCode CLI Docs](https://opencode.ai/docs/cli/)
- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli)
- [Gemini CLI Docs](https://google-gemini.github.io/gemini-cli/)
