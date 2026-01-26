# Planner

lets brainstorm the task /home/eng/Workspace/my-agent/devsfactory/.devsfactory/20260125180910-document-parsers/task.md to generate subtasks as instructed  
 in @DESIGN.md

# Completing Task Prompt

You are reviewing the task /home/eng/Workspace/my-agent/devsfactory/.devsfactory/20260125180901-types-and-frontmatter/task.md with the subtasks planned at /home/eng/Workspace/my-agent/devsfactory/.devsfactory/20260125180901-types-and-frontmatter/plan.md.

We've implemented the whole task and subtasks and need you to review it for us. It's implemented in this current working directory, on this current branch,

Check against the task acceptance criteria. Mark all items that are done there.

If it's fully complete, mark the plan status to AGENT_REVIEW and save the file.

Else, If you found items that are still missing, please break them into new subtasks following the template at /home/eng/Workspace/my-agent/devsfactory/skills/templates/subtask.md and add them to the plan.

# Completion Reviewer

You are reviewing task: /home/eng/Workspace/my-agent/devsfactory/.devsfactory/20260125180901-types-and-frontmatter/task.md with the subtasks planned at /home/eng/Workspace/my-agent/devsfactory/.devsfactory/20260125180901-types-and-frontmatter/plan.md.

Use the code-review skill to run this review against this worktree branch `20260125180901-types-and-frontmatter` commits.

If there are still Review Attempts to be filled at the task plan file, do the following:

- Review the implementation changes using code-reviewer.
- Report your findings in the respective attempt you are working on. (1, 2 or 3)
- If approved with no relevant issues, you MUST:
  - set the plan status and task status to REVIEW
  - prepare a PR title and body with these changes and add it to the Implemented PR Description of the task file

Else, if there are no review attempts it means this task became moot, the implementer agent can't complete, so:

- Report your final verdict in the Blockers session of the plan file.
- Propose any solutions if you can to unblock it.
- Set task and plan status to BLOCKED.

---

Review file template:

```md
---
task: 20260125180901-types-and-frontmatter
subtask: 001-zod-schemas
created: 2026-01-25T18:09:01Z
---

## Review Attempt 1

(to be filled by the Reviewer Agent)

## Review Attempt 2

(to be filled by the Reviewer Agent)

## Review Attempt 3

(to be filled by the Reviewer Agent)

## Review Blocked

(to be filled if all three attempts were consumed already)
```
