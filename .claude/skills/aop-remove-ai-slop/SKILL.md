---
name: aop-remove-ai-slop
description: Remove AI code slop from the current changes
---

# Remove AI code slop

Check the current changes (staged, unstaged, or commit diffs, prompt the user if unclear), and remove all AI generated slop introduced in this branch.

This includes:

- Extra comments that a human wouldn't add or is inconsistent with the rest of the file
- Extra defensive checks or try/catch blocks that are abnormal for that area of the codebase (especially if called by trusted / validated codepaths)
- Casts to any to get around type issues
- Any other style that is inconsistent with the file
- also be mindful about deadcode, redeclared functions, DRY, YAGNI, and also for reinventing the wheel (recreating functionalities that already exist in the codebase, skipping existing utilities/packages patterns like not using the infra logger and using console.log)

Report at the end with only a 1-3 sentence summary of what you changed
