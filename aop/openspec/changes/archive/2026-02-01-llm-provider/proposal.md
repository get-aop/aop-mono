## Why

The agent-spawner needs to call LLM agents (Claude Code, and later Codex, OpenCode, etc.) but currently there's no abstraction layer. The existing implementation in prepivot-aop hardcodes Claude Code CLI specifics. We need a generic interface so agent-spawner can work with any LLM provider without knowing implementation details.

## What Changes

- New `llm-provider` package with generic interface for LLM agent interaction
- `LLMProvider` interface defining `run()` method with prompt, cwd, resume support
- `ClaudeCodeProvider` implementation wrapping the Claude CLI
- Session resume capability via `resumeSessionId` option
- Stream output via `onOutput` callback (parsed JSON, provider-specific format)

## Capabilities

### New Capabilities

- `llm-provider`: Generic interface for spawning and interacting with LLM agents, supporting session resume and stream output

### Modified Capabilities

(none)

## Impact

- New package: `packages/llm-provider/`
- Will be consumed by `packages/agent-spawner/`
- Dependency on Claude CLI being available in PATH
