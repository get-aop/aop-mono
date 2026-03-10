---
name: "AOP: From Ticket"
description: Start a new task from a GitHub issue, Linear ticket, or existing document. This command skips brainstorming and writes the task directly from the source material.
category: AOP
tags: [aop, task, planning, github, linear]
---

Start a new AOP task from an existing ticket or document.

## Input

The argument after `/aop:from-ticket` is one of:

- a GitHub issue reference or URL
- a Linear ticket reference or URL
- a local file path
- pasted requirement text

If no usable source is provided, ask for the ticket or document before proceeding.

## Rules

- This is the only entrypoint when requirements already exist.
- Do not invoke brainstorming or any other planning command or skill.
- Only ask follow-up questions for blocking ambiguities the source does not answer.
- If GitHub or Linear is not connected, use pasted text or a local file without changing the workflow.

## Process

1. Read the source material.
2. Verify the source against the codebase and fix stale assumptions in the plan.
3. Derive a kebab-case task slug from the source title.
4. Create `openspec/changes/<task-slug>/` if it does not exist.
5. Write `openspec/changes/<task-slug>/source.md` with the extracted requirements.
6. Write `openspec/changes/<task-slug>/tasks.md` with a self-contained implementation checklist.
7. Present the task slug, written files, and a short summary for review.

## Guardrails

- Do not start implementation.
- Do not redirect to any other task-start command.
- Keep the task file self-contained for background execution.
