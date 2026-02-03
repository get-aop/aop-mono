## 1. Package Setup

- [x] 1.1 Create `packages/llm-provider/` with package.json and tsconfig.json
- [x] 1.2 Create src directory structure with index.ts, types.ts, and providers/ folder

## 2. Type Definitions

- [x] 2.1 Define `RunOptions` interface (prompt, cwd, resumeSessionId, onOutput)
- [x] 2.2 Define `RunResult` interface (exitCode, sessionId)
- [x] 2.3 Define `LLMProvider` interface (name, run method)

## 3. Claude Code Provider

- [x] 3.1 Implement `ClaudeCodeProvider` class with `name` property
- [x] 3.2 Implement command building (claude CLI with required flags)
- [x] 3.3 Implement stream parsing (JSON lines from stdout)
- [x] 3.4 Implement session ID extraction from stream messages
- [x] 3.5 Implement resume support via `--resume` flag

## 4. Exports

- [x] 4.1 Export types and ClaudeCodeProvider from index.ts

## 5. Tests

- [x] 5.1 Add unit tests for ClaudeCodeProvider
- [x] 5.2 Add integration test calling Claude Code with basic prompt

## 6. Documentation

- [x] 6.1 Create README.md for llm-provider package
