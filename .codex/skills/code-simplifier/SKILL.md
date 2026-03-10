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

1. **Identify scope** - Determine which files or sections to review
2. **Read the code** - Load relevant files into context
3. **Analyze** - Find opportunities to improve clarity and consistency
4. **Apply refinements** - Make changes that preserve functionality
5. **Summarize** - Report significant changes made

## Refinement Guidelines

### Preserve Functionality

Never change what code does, only how it does it. All features, outputs, and behaviors must remain intact.

### Apply Project Standards

Follow coding standards from repo guidance. Match existing patterns in the codebase.

### Enhance Clarity

- Reduce unnecessary complexity and nesting
- Eliminate redundant code and abstractions
- Use clear, descriptive variable and function names
- Consolidate related logic
- Remove comments that describe obvious code
- Split long functions when they are carrying too many concerns

### Avoid

- Nested ternary operators
- Dense one-liners that sacrifice readability
- Over-clever solutions that are hard to understand
- Combining too many concerns into single functions
- Prioritizing fewer lines over readability
