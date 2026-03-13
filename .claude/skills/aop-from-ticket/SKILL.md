---
name: aop-from-ticket
description: Use when the user already has a GitHub issue, Linear ticket, file, or pasted requirements and wants a repo-local task package created from that source.
---

# AOP From Ticket

Start a new AOP task from an existing ticket or document.

## Input

The user provides one of:

- a GitHub issue reference or URL
- a Linear ticket reference, URL, range, or mixed comma-separated list
- a local file path
- pasted requirement text

If no usable source is provided, ask for the ticket or document before proceeding.

## Rules

- This is the requirements-first entrypoint.
- Do not invoke brainstorming or any other planning skill.
- Only ask follow-up questions for blocking ambiguities the source does not answer.
- For Linear, accept a single ref like `ENG-123`, a URL, a range like `ENG-123..ENG-130`, or a mixed comma-separated list.
- Prefer the local OAuth flow for Linear. `LINEAR_API_KEY` is only a fallback for CI or other headless usage.
- If GitHub or Linear is not connected, use pasted text or a local file without changing the workflow.
- If an imported Linear issue has a missing `blocks` dependency, auto-import the blocker as a draft task.
- If the current working directory is a git repo, auto-register that repo. Never stop to ask the user to run repo registration separately.
- After writing the task files, ask whether the task should be started now.

## Process

1. Read the source material.
2. For Linear, detect the local server URL from `AOP_LOCAL_SERVER_URL`; if it is unset, use `http://127.0.0.1:25150`.
3. Probe `<local-server-url>/api/health` before doing anything else. If it responds, do not try to start another local server process.
4. If the local server is available, call `POST /api/linear/import` with the original input and the current working directory. This route auto-registers the repo, imports requested issues plus missing blockers, and writes a non-placeholder `task.md`.
5. If the local server route is unavailable, resolve refs, URLs, ranges, and mixed lists into the full issue set before writing files.
6. If a required Linear blocker is missing locally, import it as a draft dependency task in the same repo.
7. Use the imported `task.md` as the source of truth for the issue description and metadata. Do not read the token store or make ad hoc Linear API calls unless the local-server import path is unavailable.
8. Verify the source against the codebase and fix stale assumptions in the plan.
9. Derive a kebab-case task slug from the source title for each imported task.
10. Create `docs/tasks/<task-slug>/` if it does not exist.
11. Write `docs/tasks/<task-slug>/plan.md` with the implementation checklist, context, and verification steps.
12. Add numbered subtask files when the work needs multiple executable slices.
13. Report which tasks came from the requested input and which were auto-imported as blockers.
14. Ask whether the imported tasks should be started now.
15. If the answer is yes, invoke `aop-task-ready` only for the imported tasks that should move to `READY`.
16. Explain that some started tasks may remain `READY` until their dependency tasks are `DONE`.
17. Present the task slug(s), written files, final status, and a short summary.

## Guardrails

- Do not start implementation.
- Keep the task files self-contained for background execution.
- Do not auto-start imported work without first asking.
- Save the files. Chat-only output is a failure.
