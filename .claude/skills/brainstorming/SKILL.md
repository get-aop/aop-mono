---
name: brainstorming
description: "Use before shaping new behavior in AOP. Clarifies intent, constraints, and success criteria before planning or implementation. For AOP task creation, prefer `/aop:from-scratch` as the public entrypoint."
---

# Brainstorming

Help turn an idea into a validated design before any task planning or coding starts.

## Process

1. Inspect the current repo state first: relevant files, docs, and recent behavior.
2. Ask one question at a time until purpose, constraints, and success criteria are clear.
3. Propose 2-3 approaches with trade-offs.
4. Recommend one approach and explain why it best fits the current codebase.
5. Present the design in small sections and validate each section with the user.

For AOP task creation specifically, do not use this as the public entrypoint. Use `/aop:from-scratch` instead.

## Output Contract

When brainstorming is complete, output the final design using this exact marker:

```text
[BRAINSTORM_COMPLETE]
{
  "design": "Validated design content here"
}
```

CRITICAL:
- Output only the marker and raw JSON in the final response.
- Stop immediately after the JSON block.
- Do not start implementation during brainstorming.

## Guardrails

- Keep questions sequential. Do not batch them.
- Prefer concrete trade-offs over generic suggestions.
- Remove optional complexity unless it is clearly justified.
- Align the design to the current `docs/tasks` workflow and existing architecture.
