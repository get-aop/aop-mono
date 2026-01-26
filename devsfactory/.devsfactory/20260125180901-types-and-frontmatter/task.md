---
title: Types and Frontmatter Parsing
status: REVIEW
created: 2026-01-25T00:00:00Z
priority: high
tags: [foundation, types, parser]
assignee: null
dependencies: []
---

## Description

Establish the foundational type system and YAML frontmatter parsing utilities that all other components depend on. This is the first phase and has no dependencies.

Uses Zod for schema definitions with runtime validation. TypeScript types are derived from schemas using `z.infer<typeof Schema>` - single source of truth, no duplication.

## Requirements

### Zod Schemas and Types (`src/types/index.ts`)

Use Zod to define schemas that provide both runtime validation and TypeScript types:

- Define `TaskStatusSchema` as enum: `'DRAFT' | 'BACKLOG' | 'PENDING' | 'INPROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE'`
- Define `SubtaskStatusSchema` as enum: `'PENDING' | 'INPROGRESS' | 'AGENT_REVIEW' | 'DONE' | 'BLOCKED'`
- Define `PlanStatusSchema` as enum: `'INPROGRESS' | 'BLOCKED' | 'REVIEW'`
- Define `PrioritySchema` as enum: `'high' | 'medium' | 'low'`
- Define `TaskFrontmatterSchema` with: title (string), status (TaskStatusSchema), created (z.coerce.date), priority (PrioritySchema), tags (string array, default []), assignee (string nullable, default null), dependencies (string array, default [])
- Define `PlanFrontmatterSchema` with: status (PlanStatusSchema), task (string), created (z.coerce.date)
- Define `SubtaskFrontmatterSchema` with: title (string), status (SubtaskStatusSchema), dependencies (number array, default [])
- Define `TaskSchema` with: folder (string), frontmatter (TaskFrontmatterSchema), description (string), requirements (string), acceptanceCriteria (array of {text, checked}), notes (string optional)
- Define `PlanSchema` with: folder (string), frontmatter (PlanFrontmatterSchema), subtasks (array of SubtaskReferenceSchema)
- Define `SubtaskSchema` with: filename (string), number (number), slug (string), frontmatter (SubtaskFrontmatterSchema), description (string), context (string optional), result (string optional), review (string optional), blockers (string optional)
- Define `SubtaskReferenceSchema` with: number (number), slug (string), title (string), dependencies (number array)
- Define `AgentTypeSchema` as enum: `'planning' | 'implementation' | 'review'`
- Define `AgentProcessSchema` with: id (string), type (AgentTypeSchema), taskFolder (string), subtaskFile (string optional), pid (number), startedAt (z.coerce.date)
- Define `ConfigSchema` with: maxConcurrentAgents (number, default 3), devsfactoryDir (string, default '.devsfactory'), worktreesDir (string, default '.worktrees')
- Export all schemas AND inferred types (e.g., `export type Task = z.infer<typeof TaskSchema>`)

### Frontmatter Parser (`src/parser/frontmatter.ts`)

- Use the `yaml` package for YAML parsing
- Use Zod schemas for validation (passed as parameter)
- Implement `parseFrontmatter<T>(markdown: string, schema: z.ZodType<T>): { frontmatter: T; content: string }`
  - Split markdown on `---` delimiters
  - Parse YAML frontmatter section
  - Validate and transform using `schema.parse()` (throws ZodError if invalid)
  - Return structured object with validated frontmatter and remaining content
  - Handle edge cases: missing frontmatter, empty content, malformed YAML
- Implement `safeParseFrontmatter<T>(markdown: string, schema: z.ZodType<T>): { success: true; data: { frontmatter: T; content: string } } | { success: false; error: z.ZodError }`
  - Same as parseFrontmatter but uses `schema.safeParse()` for non-throwing validation
- Implement `serializeFrontmatter<T>(doc: { frontmatter: T; content: string }): string`
  - Stringify frontmatter to YAML
  - Combine with content using `---` delimiters
  - Ensure proper newline handling
  - Handle Date objects (serialize as ISO strings)
- Implement `updateFrontmatter<T>(filePath: string, schema: z.ZodType<T>, updater: (current: T) => T): Promise<void>`
  - Read file using `Bun.file()`
  - Parse and validate frontmatter using schema
  - Apply updater function
  - Write back to file
  - Handle file not found errors gracefully

### Tests (`src/types/index.test.ts`)

- Test TaskStatusSchema accepts valid values, rejects invalid
- Test TaskFrontmatterSchema with all fields
- Test TaskFrontmatterSchema applies defaults for optional fields
- Test date coercion (ISO string → Date object)
- Test SubtaskFrontmatterSchema with dependencies array

### Tests (`src/parser/frontmatter.test.ts`)

- Test parsing valid frontmatter with all fields
- Test parsing with missing optional fields (defaults applied)
- Test parsing with empty content section
- Test parsing with no frontmatter (should throw ZodError)
- Test parsing with invalid field values (should throw ZodError with helpful message)
- Test safeParseFrontmatter returns success/error without throwing
- Test serialization round-trip (parse then serialize equals original)
- Test serialization handles Date objects correctly
- Test updateFrontmatter with status change
- Test updateFrontmatter with non-existent file

## Acceptance Criteria

- [x] All Zod schemas are defined and exported from `src/types/index.ts`
- [x] All TypeScript types are derived from schemas using `z.infer` and exported
- [x] Schemas validate correctly and provide helpful error messages
- [x] Default values work for optional fields (tags, assignee, dependencies)
- [x] Date coercion works (ISO strings → Date objects)
- [x] `parseFrontmatter` correctly parses and validates YAML frontmatter from markdown
- [x] `safeParseFrontmatter` returns result object without throwing
- [x] `serializeFrontmatter` produces valid markdown with YAML frontmatter
- [x] Round-trip parsing and serialization preserves data integrity
- [x] `updateFrontmatter` reads, modifies, and writes frontmatter atomically
- [x] All tests pass: `bun test src/types/ src/parser/frontmatter.test.ts`
- [x] No TypeScript errors: `bunx tsc --noEmit`

## Notes

- Use `Bun.file()` for file operations, not Node.js fs module
- Follow newspaper style: exported functions at top, helpers below
- Dependencies: `zod` (latest 3.x), `yaml` (version 2.x for ESM compatibility)
- Use `z.coerce.date()` for date fields to handle ISO string conversion
- Export both schemas (for runtime validation) and types (for TypeScript)

## Implemented PR Description

**Title**: feat: add Zod schemas and YAML frontmatter parsing utilities

**Body**:
## Summary
- Add 14 Zod schemas for task management types with runtime validation (`src/types/index.ts`)
- Implement YAML frontmatter parsing utilities with parse, safeParse, serialize, and update functions (`src/parser/frontmatter.ts`)
- Add comprehensive test coverage with 56 tests and 160 assertions

## Test plan
- [x] Run `bun test src/types/ src/parser/frontmatter.test.ts` - all 56 tests pass
- [x] Run `bunx tsc --noEmit` - no TypeScript errors
- [x] Verify date coercion works (ISO strings → Date objects)
- [x] Verify roundtrip parsing/serialization preserves data integrity
- [x] Verify default values applied for optional fields
