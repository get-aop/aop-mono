---
name: code-simplifier
description: >
  Simplifies and refines code for clarity, consistency, and maintainability while preserving all functionality.
  Focuses on recently modified code unless instructed otherwise.
  Use when: (1) After completing code changes and wanting to review/refine them,
  (2) User requests code simplification or cleanup,
  (3) User asks to review recent changes for clarity,
  (4) User wants to apply project coding standards to modified code.
  Triggers on requests like "simplify this code", "clean up my changes", "review for clarity", or "/simplify".
---

# Code Simplifier

Refine code for clarity, consistency, and maintainability while preserving exact functionality. Prioritize readable, explicit code over compact solutions.

## Scope Detection

Identify code to review using one of these methods:

**Git-based** (default): Run `git diff` and `git diff --cached` to find modified files and changed sections.

**Session-based**: Review files modified during the current conversation when git context is unavailable.

**Explicit**: User specifies files or directories to review.

## Refinement Process

1. **Identify scope** - Determine which files/sections to review
2. **Read the code** - Load relevant files into context
3. **Analyze** - Find opportunities to improve clarity and consistency
4. **Apply refinements** - Make changes that preserve functionality
5. **Summarize** - Report significant changes made

## Refinement Guidelines

### Preserve Functionality

Never change what code does - only how it does it. All features, outputs, and behaviors must remain intact.

### Apply Project Standards

Follow coding standards from CLAUDE.md. Match existing patterns in the codebase.

### Enhance Clarity

- Reduce unnecessary complexity and nesting
- Eliminate redundant code and abstractions
- Use clear, descriptive variable and function names
- Consolidate related logic
- Remove comments that describe obvious code
- Single responsibility principle: if you see functions with a long body, or doing too much, refactor it into smaller ones.

### Avoid

- Nested ternary operators - use switch/if-else for multiple conditions
- Dense one-liners that sacrifice readability
- Over-clever solutions that are hard to understand
- Combining too many concerns into single functions
- Removing helpful abstractions that improve organization
- Prioritizing "fewer lines" over readability

## Examples

### Before: Nested ternary
```typescript
const status = isLoading ? 'loading' : hasError ? 'error' : isComplete ? 'complete' : 'idle';
```

### After: Explicit switch
```typescript
const getStatus = () => {
  if (isLoading) return 'loading';
  if (hasError) return 'error';
  if (isComplete) return 'complete';
  return 'idle';
};
const status = getStatus();
```

### Before: Overly compact
```typescript
const result = data?.items?.filter(x => x.active)?.map(x => x.id) ?? [];
```

### After: Explicit with early return
```typescript
const getActiveIds = (data: Data | undefined): string[] => {
  if (!data?.items) return [];
  return data.items
    .filter(item => item.active)
    .map(item => item.id);
};
const result = getActiveIds(data);
```
