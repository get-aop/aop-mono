## Context

The AOP platform needs to spawn LLM agents to perform coding tasks. Currently, the only reference implementation (in prepivot-aop) directly spawns the Claude CLI with hardcoded flags. As we plan to support multiple LLM backends (Codex, OpenCode, etc.), we need an abstraction layer.

The `agent-spawner` package will consume this interface to spawn agents without coupling to specific LLM implementations.

## Goals / Non-Goals

**Goals:**
- Generic `LLMProvider` interface that any LLM backend can implement
- Claude Code provider as first implementation
- Session resume support via `resumeSessionId`
- Stream output via callback (parsed JSON, not normalized)
- Simple, minimal API surface

**Non-Goals:**
- Event/log normalization across providers (each provider emits its native format)
- Factory pattern or provider registry (direct instantiation for now)
- Configurable CLI flags (hardcode sensible defaults)
- Support for providers other than Claude Code (future work)

## Decisions

### 1. Direct class instantiation over factory pattern

**Decision**: Use `new ClaudeCodeProvider()` instead of `createProvider({ type: "claude-code" })`.

**Rationale**: Only one provider exists. Factory adds indirection without benefit. Can refactor when second provider is added.

**Alternatives considered**:
- Factory pattern: Premature abstraction for single provider
- Dependency injection: Overkill for this use case

### 2. Pass-through output over normalized events

**Decision**: `onOutput(data: Record<string, unknown>)` passes provider's native parsed JSON.

**Rationale**: Consumers (agent-spawner) may need provider-specific fields. Normalization is additional work without clear requirements. Can add normalization layer later if needed.

**Alternatives considered**:
- Normalized event types: Requires defining common schema across providers we don't have yet
- Raw string output: Forces consumers to parse JSON

### 3. Hardcode CLI flags

**Decision**: Always use `--output-format stream-json --verbose --dangerously-skip-permissions`.

**Rationale**: These are required for agentic operation. Making them configurable adds API surface without benefit.

### 4. Session ID extraction from stream

**Decision**: Parse `session_id` from stream messages and return in `RunResult`.

**Rationale**: Enables session resume without consumer parsing the stream.

## Risks / Trade-offs

**[Different providers have different stream formats]** → Accept this. Consumers handle provider-specific parsing. Normalization can be added later.

**[Claude CLI must be in PATH]** → Document requirement. Fail fast with clear error if not found.

**[No timeout support]** → Out of scope for v1. LLM sessions can be long-running by design.
