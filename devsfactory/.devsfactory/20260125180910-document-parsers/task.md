---
title: Document Parsers for Task, Plan, and Subtask Files
status: PENDING
created: 2026-01-25T00:00:00Z
priority: high
tags: [parser, core]
assignee: null
dependencies: [20260125180901-types-and-frontmatter]
---

## Description

Build specialized parsers for each document type (task.md, plan.md, subtask files) that use the frontmatter parser and Zod schemas from Phase 1. These parsers provide a clean API for the orchestrator to read and write task state.

Each parser passes the appropriate schema (e.g., `TaskFrontmatterSchema`) to `parseFrontmatter()` for automatic validation and type inference.

## Requirements

### Task Parser (`src/parser/task.ts`)

- Implement `parseTask(taskFolder: string): Promise<Task>`
  - Read `.devsfactory/{taskFolder}/task.md`
  - Parse frontmatter using `parseFrontmatter(content, TaskFrontmatterSchema)`
  - Extract sections: Description, Requirements, Acceptance Criteria, Notes
  - Parse acceptance criteria as checkbox items `- [ ]` or `- [x]`
  - Return fully populated Task object (validated by Zod)
- Implement `createTask(taskFolder: string, task: Omit<Task, 'folder'>): Promise<void>`
  - Create directory `.devsfactory/{taskFolder}/` if not exists
  - Serialize task to markdown with YAML frontmatter
  - Write to `.devsfactory/{taskFolder}/task.md`
- Implement `updateTaskStatus(taskFolder: string, status: TaskStatus): Promise<void>`
  - Use `updateFrontmatter` to change status field only
- Implement `listTaskFolders(): Promise<string[]>`
  - Scan `.devsfactory/` for directories
  - Filter to only directories containing `task.md`
  - Return sorted list of folder names

### Plan Parser (`src/parser/plan.ts`)

- Implement `parsePlan(taskFolder: string): Promise<Plan | null>`
  - Read `.devsfactory/{taskFolder}/plan.md` if it exists
  - Return null if file doesn't exist
  - Parse frontmatter using `parseFrontmatter(content, PlanFrontmatterSchema)`
  - Parse subtask list from content (format: `1. 001-slug (Title) → depends on: 002, 003`)
  - Return Plan object with subtask references (validated by Zod)
- Implement `createPlan(taskFolder: string, plan: Omit<Plan, 'folder'>): Promise<void>`
  - Serialize plan frontmatter and subtask list
  - Write to `.devsfactory/{taskFolder}/plan.md`
- Implement `updatePlanStatus(taskFolder: string, status: PlanStatus): Promise<void>`
  - Use `updateFrontmatter` to change status field
- Implement `addSubtaskToPlan(taskFolder: string, subtask: SubtaskReference): Promise<void>`
  - Read existing plan
  - Append new subtask to list
  - Write back plan

### Subtask Parser (`src/parser/subtask.ts`)

- Implement `parseSubtask(taskFolder: string, filename: string): Promise<Subtask>`
  - Read `.devsfactory/{taskFolder}/{filename}`
  - Parse frontmatter using `parseFrontmatter(content, SubtaskFrontmatterSchema)`
  - Extract number and slug from filename (e.g., `001-create-user-model.md`)
  - Extract sections: Description, Context, Result, Review, Blockers
  - Return fully populated Subtask object (validated by Zod)
- Implement `createSubtask(taskFolder: string, subtask: Omit<Subtask, 'filename' | 'number' | 'slug'>): Promise<string>`
  - Determine next subtask number (scan existing, increment)
  - Generate filename from number and title slug
  - Write to `.devsfactory/{taskFolder}/{NNN}-{slug}.md`
  - Return the generated filename
- Implement `updateSubtaskStatus(taskFolder: string, filename: string, status: SubtaskStatus): Promise<void>`
  - Use `updateFrontmatter` to change status
- Implement `listSubtasks(taskFolder: string): Promise<Subtask[]>`
  - Glob for `{NNN}-*.md` files (exclude `*-review.md`)
  - Parse each subtask
  - Return sorted by number
- Implement `getReadySubtasks(taskFolder: string): Promise<Subtask[]>`
  - Get all subtasks
  - Filter to PENDING status
  - Filter to those whose dependencies are all DONE
  - Return list of ready subtasks
- Implement `appendReviewHistory(taskFolder: string, subtaskFilename: string, reviewContent: string): Promise<void>`
  - Derive review filename: `{NNN}-{slug}-review.md`
  - Append review entry with timestamp header
  - Create file if doesn't exist

### Tests

- `src/parser/task.test.ts`:
  - Test parseTask with sample task.md from DESIGN.md
  - Test createTask creates valid file structure
  - Test updateTaskStatus changes only status
  - Test listTaskFolders finds all task directories
- `src/parser/plan.test.ts`:
  - Test parsePlan with sample plan.md
  - Test parsePlan returns null for missing file
  - Test createPlan with subtask list
  - Test addSubtaskToPlan appends correctly
- `src/parser/subtask.test.ts`:
  - Test parseSubtask extracts all sections
  - Test createSubtask generates correct numbering
  - Test listSubtasks excludes review files
  - Test getReadySubtasks respects dependencies
  - Test appendReviewHistory creates and appends

## Acceptance Criteria

- [x] `parseTask` correctly parses task.md files matching DESIGN.md format
- [x] `createTask` creates properly formatted task.md with all sections
- [x] `parsePlan` correctly parses plan.md including subtask references
- [x] `parseSubtask` extracts number, slug, and all sections from subtask files
- [x] `createSubtask` auto-increments subtask numbers correctly
- [x] `getReadySubtasks` correctly identifies subtasks with satisfied dependencies
- [x] `listTaskFolders` returns all valid task directories
- [x] Review history files are properly created and appended
- [x] All tests pass: `bun test src/parser/`
- [x] No TypeScript errors: `bunx tsc --noEmit`

## Notes

- Use `Bun.file().exists()` to check file existence
- Use glob pattern matching for listing files (Bun.Glob or similar)
- Slugify titles by lowercasing and replacing spaces with hyphens
- Subtask numbers are zero-padded to 3 digits: 001, 002, etc.
- Import schemas from `src/types/index.ts` (e.g., `TaskFrontmatterSchema`)
- Zod validation happens automatically in `parseFrontmatter()` - no separate validation needed
- If validation fails, `parseFrontmatter()` throws `ZodError` with detailed message

## Implemented PR Description
(filled by agent after completion)

{PR_TITLE}

{PR_DESCRIPTION}
