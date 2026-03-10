---
name: aop-brainstorming
description: "Use before idea-first AOP task creation. Clarifies intent and writes the approved design to docs/tasks/<task-slug>/design.md before task scaffolding continues."
---

# AOP Brainstorming

Help turn an AOP idea into an approved task-local design document before task files are created.

<HARD-GATE>
Do NOT create `task.md`, `plan.md`, numbered subtasks, or start implementation while running this skill. This skill stops after writing the approved `design.md`.
</HARD-GATE>

## Checklist

Complete these items in order:

1. Explore the current repo context
2. Offer the visual companion if upcoming questions are visual
3. Ask clarifying questions one at a time
4. Propose 2-3 approaches with trade-offs and recommend one
5. Present the design in sections and get approval
6. Derive the AOP task slug
7. Write the approved design to `docs/tasks/<task-slug>/design.md`
8. Return control to the calling command so it can create the task files

## Rules

- Use the task-local folder pattern: `docs/tasks/<task-slug>/`.
- The design artifact for AOP must be `docs/tasks/<task-slug>/design.md`.
- Create `docs/tasks/<task-slug>/` if needed before writing `design.md`.
- Do not write to `docs/superpowers/specs/`.
- Do not invoke or depend on any generic `brainstorming` skill.
- Do not invoke `writing-plans`.
- Do not create or modify any skill outside this task-local design flow.

## Design Doc Contract

Write the approved design to:

`docs/tasks/<task-slug>/design.md`

The design should be the source of truth for the next command step that writes:

- `task.md`
- `plan.md`
- numbered subtask files when needed

The calling command must read `design.md` from disk before it writes any task files.

## Output

When the design file is written, report:

- the chosen task slug
- the path to `design.md`
- that task creation can continue using `design.md` as the source of truth

## Companion Files

When the visual flow is needed, follow:

- `./visual-companion.md`
- `./spec-document-reviewer-prompt.md`
