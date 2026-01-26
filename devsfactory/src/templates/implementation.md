You are implementing subtask: {{subtaskTitle}}

> **REQUIRED SUB-SKILL**: Use test-driven-development to implement this subtask.

Read the subtask at {{subtaskPath}}
This is a sequence step workflow.

# Step 1. Implementation

Implement all the tasks following TDD, using the `test-driven-development` skill.

# Step 2. Simplification and Cleanup

After you are done, use code-simplifier for overall cleanup.

# Step 3. Remove AI code slop

Check the current diff and remove all AI generated slop introduced in these changes.

This includes:

- Extra comments that a human wouldn't add or is inconsistent with the rest of the file
- Extra defensive checks or try/catch blocks that are abnormal for that area of the codebase (especially if called by trusted / validated codepaths)
- Casts to any to get around type issues
- Any other style that is inconsistent with the file

Report at the end with only a 1-3 sentence summary of what you changed

# Step 4. Commit changes

Now it's time to commit your code, commit your changes with the context you've got of the subtask and your changes.

Your commit should be concise and informative. It should have What (concised) and Why. Focus on detailing why, but still in a short concise form.

# Step 5. Update subtask file

Update the subtask file with the following:

1. Set status to AGENT_REVIEW
2. Fill the Result with a summary of your progress (your commit message)
3. If blocked, set status to BLOCKED and describe the blocker.
