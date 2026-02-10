---
name: aop-plan-from-discussion
description: Use when the user has been discussing an implementation approach in the current session and wants to crystallize the discussion into a structured task document for autonomous background agent execution. Triggers on "create a tasks.md from our discussion", "turn this into tasks for an agent", "write an implementation plan from what we discussed". Do NOT use when there is a pre-written document or spec — use aop-plan-task instead.
---

# Plan From Discussion

Distill a collaborative conversation — where options were explored, codebase was researched, and decisions were made — into a self-contained task document that a background agent can execute autonomously without access to the conversation.

## When to Use

- User has been discussing an implementation approach in the current session
- Decisions have been made (option chosen, approach agreed on)
- User asks to "create a tasks.md", "write this up as tasks", "turn this into a plan for an agent"
- The output must be executable by an agent with NO conversation context

**Do NOT use when:** a pre-written document, spec, or issue exists as input — use `aop-plan-task` instead.

## Process

1. **Harvest conversation context**: Identify all decisions made, options rejected, codebase findings, and architectural constraints discussed. The agent executing the tasks has zero context from this conversation.
2. **Research and verify**: Read any files the conversation referenced but didn't actually open. Cross-check claims from the discussion against the real codebase — service names, file paths, dependencies, and architectural assumptions may be wrong or stale. Correct inaccuracies silently in the task document; do not parrot wrong information from the conversation.
3. **Flag undecided choices**: If the discussion leaned toward an option but the user never firmly committed ("maybe", "I guess", "probably"), add an `### Open Decisions` section in the Context with a bold warning that the implementing agent must confirm with the developer before starting. Proceed with the best-guess assumption in the tasks, but make it swappable (e.g., define an interface so the implementation can change without rewriting).
4. **Determine environment constraints**: How will this be built, run, and tested? What commands does the repo use? What environments exist (CI, local, cloud)? Include an environment compatibility section if behavior varies.
5. **Write the task document**: Follow the output format below. Save to the path the user specifies (typically `openspec/changes/<slug>/tasks.md`).
6. **Present for review**: Show the file path and a brief summary. Ask the user to review.

## Output Format

```markdown
# [Title]

## Context

[WHY this change exists — the problem being solved, 2-3 sentences]

[WHAT the approach is — architectural decisions, key design choices]

### Architecture
[How the pieces fit together. Bullet points with bold labels.]

### How it works across environments
[Table or bullets explaining behavior in CI, local dev, cloud, etc.]
[Only include if behavior varies across environments]

### Key files
[Bulleted list of files that will be touched, with one-line descriptions]

---

## Section N: [Cohesive Group Name]

> **Files**: `path/to/file.ts`, `path/to/other.ts`

- [ ] [Specific, actionable task with enough detail to execute without ambiguity]
- [ ] [Next task — include code snippets as GUIDANCE when the exact API/interface matters]

---

## Section N+1: Verification (MANDATORY)

> **CRITICAL**: The implementing agent MUST execute these verification steps themselves.
> Do NOT mark this section complete without actually running the commands and
> confirming the output.

- [ ] [Environment setup verification — confirm services started correctly]
- [ ] [Run the specific test suite — include exact command]
- [ ] [Check logs/output for specific evidence — tell the agent what to look for]
- [ ] [If any test fails, debug and re-run until all pass. Do not leave failing tests.]
```

## Key Techniques

### Self-containment
The agent has NO access to the conversation. Every decision, constraint, and rationale must be in the document. If you discussed "option 3" — explain what option 3 IS, don't reference it by number.

### Code snippets as guidance, not prescriptions
Include TypeScript interfaces, function signatures, and example usage when the exact shape matters. Mark them as guidance — the agent should adapt, not blindly copy-paste.

### Environment compatibility table
When behavior varies across environments (CI vs local vs cloud), include a table showing who does what and whether the feature works in each. Agents will otherwise make assumptions.

### File scope annotations
Each section starts with `> **Files**: ...` so the agent knows exactly which files to touch for that batch of work.

### Mandatory self-verification
The last section MUST be verification with explicit commands and expected output. Use bold **CRITICAL** callout and language like "The implementing agent MUST execute these verification steps themselves." Agents will skip verification unless the document is unambiguous that it's required.

### Port/URL/constant choices
When picking constants (ports, paths, names), explain WHY that value was chosen (e.g., "Port 9099 is unused in compose.yaml and sits in the 9000s internal-tooling range"). This prevents the agent from second-guessing or changing it.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Referencing conversation context ("as we discussed", "option 3") | Inline the full explanation — agent has no conversation access |
| Tasks too vague ("update the tests") | Be specific: which test, which file, what assertions to add |
| Missing environment details | Include how to start services, what env vars to set, which commands to run |
| Verification section is soft ("make sure tests pass") | Include exact commands, expected log output, and explicit "do not leave failing tests" |
| Code snippets without context | Explain what the snippet does and where it goes — don't assume the agent knows the codebase |
| Sections grouped by file instead of by intent | Group by cohesive domain ("Environment Configuration") not by file ("Changes to globalSetup.ts") |
| Parroting wrong info from the discussion | Verify claims against the real codebase — service names, file paths, and dependencies may be wrong or stale |
| Proceeding with ambiguous decisions as if they're final | Add an `### Open Decisions` section flagging anything the user said "maybe", "I guess", or "probably" about |

## Guardrails

- **Always save the file** — the task document is the deliverable, not chat output
- **Plan, don't implement** — do NOT write code. Only write the task document
- **Right-size sections** — group 2-6 related tasks per section. One task per section is too granular; 15 tasks per section is too broad
- **Verification is non-negotiable** — every task document MUST end with a verification section. If you skip it, background agents will skip testing
