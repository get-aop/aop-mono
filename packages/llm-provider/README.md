# @aop/llm-provider

Generic interface for spawning and interacting with LLM agents.

## Installation

```bash
bun add @aop/llm-provider
```

## Usage

```typescript
import { ClaudeCodeProvider } from "@aop/llm-provider";

const provider = new ClaudeCodeProvider();

const result = await provider.run({
  prompt: "Create a hello world function",
  cwd: "/path/to/project",
  onOutput: (data) => console.log(data),
});

console.log("Exit code:", result.exitCode);
console.log("Session ID:", result.sessionId);
```

### Resuming a Session

```typescript
const result = await provider.run({
  prompt: "Continue with the previous task",
  resumeSessionId: previousResult.sessionId,
});
```

## API

### `LLMProvider` Interface

```typescript
interface LLMProvider {
  readonly name: string;
  run(options: RunOptions): Promise<RunResult>;
}
```

### `RunOptions`

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `prompt` | `string` | Yes | The prompt to send to the LLM agent |
| `cwd` | `string` | No | Working directory for the agent session |
| `resumeSessionId` | `string` | No | Session ID to resume a previous session |
| `onOutput` | `(data: Record<string, unknown>) => void` | No | Callback for stream output |

### `RunResult`

| Property | Type | Description |
|----------|------|-------------|
| `exitCode` | `number` | Exit code of the LLM agent process |
| `sessionId` | `string \| undefined` | Session ID for potential resume |

## Providers

### ClaudeCodeProvider

Wraps the Claude CLI with the following flags:
- `--output-format stream-json`
- `--verbose`
- `--dangerously-skip-permissions`

Requires the `claude` CLI to be available in PATH.
