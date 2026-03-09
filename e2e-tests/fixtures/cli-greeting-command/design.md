## Context

This is a simple CLI command for E2E testing purposes.

## Goals / Non-Goals

**Goals:**
- Simple command that outputs a greeting

**Non-Goals:**
- Complex formatting or options

## Decisions

### 1. Command Structure

**Choice**: `aop greet <name>`

Parse the name from command line arguments and print the greeting to stdout.

### 2. Implementation

**Choice**: Create `src/commands/greet.ts` with a simple function.

```typescript
export const runGreet = (name: string): void => {
  console.log(`Hello, ${name}!`);
};
```

Wire it into the main CLI router.
