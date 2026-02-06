---
name: aop-complete-task
description: Complete a task from a git worktree by committing its changes and applying them to the current branch as staged changes. Use when the user wants to bring worktree work back to the main branch, complete a worktree task, merge worktree changes, or says "complete task". Triggers on /aop:complete-task, "complete the task", "bring worktree changes", "apply worktree to current branch".
---

# Complete Task from Worktree

Apply all changes from a git worktree to the current branch as staged (uncommitted) changes.

## Workflow

### 1. Identify the worktree

Ask the user which worktree to complete if not provided. List available worktrees:

```bash
git worktree list
```

The user provides a `<worktree-path>`. Validate it exists and has changes.

### 2. Commit changes in the worktree

Check for uncommitted changes in the worktree and commit them:

```bash
git -C <worktree-path> status
git -C <worktree-path> add -A
git -C <worktree-path> commit -m "completed: <change-name>"
```

If the worktree has no uncommitted changes (everything already committed), skip the commit step.

### 3. Find the merge base

Determine the worktree's branch and find the common ancestor with the current branch:

```bash
# Get the worktree branch name
WORKTREE_BRANCH=$(git -C <worktree-path> rev-parse --abbrev-ref HEAD)

# Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Find common ancestor
MERGE_BASE=$(git merge-base $CURRENT_BRANCH $WORKTREE_BRANCH)
```

### 4. Generate and apply the diff

Generate the full diff from the merge base to the worktree HEAD, then apply it to the current branch as staged changes:

```bash
# Generate diff
git -C <worktree-path> diff $MERGE_BASE HEAD > /tmp/worktree-changes.patch

# Ensure we're on the current branch (not in the worktree)
# Apply the patch to the working directory
git apply /tmp/worktree-changes.patch

# Clean up
rm /tmp/worktree-changes.patch
```

### 5. Confirm result

Show the user what was staged:

```bash
git diff --cached --stat
```

Report success with:

- Number of files changed
- The worktree branch name and commit range applied
- Reminder that changes are staged but NOT committed

## Error Handling

- **Conflicts on apply**: If `git apply` fails, try `git apply --3way` for three-way merge. If that also fails, report conflicting files and let the user resolve.
- **No changes**: If the diff is empty (worktree branch is identical to current), report that there are no changes to apply.
- **Dirty working directory**: If the current branch has uncommitted changes, warn the user and ask whether to proceed (changes could conflict) or stash first.
