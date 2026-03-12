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
- a Linear ticket reference, URL, range, or mixed comma-separated list
- a local file path
- pasted requirement text

If no usable source is provided, ask for the ticket or document before proceeding.

## Rules

- This is the only entrypoint when requirements already exist.
- Treat this command file as the authoritative workflow even if the source list does not present it as a skill.
- Do not invoke brainstorming or any other planning command or skill.
- Only ask follow-up questions for blocking ambiguities the source does not answer.
- For Linear, accept a single ref like `ENG-123`, a URL, a range like `ENG-123..ENG-130`, or a mixed comma-separated list.
- Prefer the local OAuth flow for Linear. `LINEAR_API_KEY` is only a fallback for CI or other headless usage.
- If GitHub or Linear is not connected, use pasted text or a local file without changing the workflow.
- If an imported Linear issue has a missing `blocks` dependency, auto-import the blocker as a draft task.
- If the current working directory is a git repo, auto-register that repo. Never stop to ask the user to run repo registration separately.
- After writing the task files, ask whether the task should be started now.

## Process

1. Read the source material.
2. For Linear, if the local server is available, call `POST /api/linear/import` with the original input and the current working directory. This route auto-registers the repo when needed and imports requested issues plus missing blockers.
3. If the local server route is unavailable, resolve refs, URLs, ranges, and mixed lists into the full issue set before writing files.
4. If a required Linear blocker is missing locally, import it as a draft dependency task in the same repo.
5. Verify the source against the codebase and fix stale assumptions in the plan.
6. Derive a kebab-case task slug from the source title for each imported task.
7. Create `docs/tasks/<task-slug>/` if it does not exist.
8. Write `docs/tasks/<task-slug>/task.md` with the extracted requirements and acceptance criteria.
9. Write `docs/tasks/<task-slug>/plan.md` with the implementation checklist, context, and verification steps.
10. Add numbered subtask files under `docs/tasks/<task-slug>/` when the work needs multiple executable slices.
11. Report which tasks came from the requested input and which were auto-imported as blockers.
12. Ask whether the imported tasks should be started now.
13. If the answer is yes, invoke the `task-ready` skill only for the imported tasks that should move to `READY`.
14. Explain that some started tasks may remain `READY` until their dependency tasks are `DONE`.
15. Present the task slug(s), written files, final status, and a short summary for review.

## Guardrails

- Do not start implementation.
- Do not redirect to any other task-start command.
- Keep the task file self-contained for background execution.
- Do not auto-start imported work without first asking.
