# SQLite Storage Implementation Design

**Date:** 2026-02-01
**Status:** Approved

## Overview

Replace file-based storage (`~/.aop/projects/*.yaml` and `.devsfactory/` markdown files) with a unified SQLite database at `~/.aop/aop.db`.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Database scope | Unified single DB with `project_name` foreign keys |
| Migration strategy | Fresh start (no auto-migration from files) |
| Change notifications | Polling at 500ms intervals |
| Replacement | Full replacement (remove filesystem implementations) |
| Task identifiers | Keep folder strings as primary keys |

## Database Schema

```sql
-- Projects table (replaces ~/.aop/projects/*.yaml)
CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  git_remote TEXT,
  registered_at TEXT NOT NULL,
  settings TEXT,  -- JSON blob for ConfigSchema.partial()
  providers TEXT  -- JSON blob for provider configs
);

-- Tasks table (replaces .devsfactory/*/task.md per project)
CREATE TABLE IF NOT EXISTS tasks (
  project_name TEXT NOT NULL REFERENCES projects(name) ON DELETE CASCADE,
  folder TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  tags TEXT,           -- JSON array
  assignee TEXT,
  dependencies TEXT,   -- JSON array
  branch TEXT,
  description TEXT NOT NULL,
  requirements TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL,  -- JSON array
  notes TEXT,
  PRIMARY KEY (project_name, folder)
);

-- Subtasks table (replaces .devsfactory/*/001-*.md)
CREATE TABLE IF NOT EXISTS subtasks (
  project_name TEXT NOT NULL,
  task_folder TEXT NOT NULL,
  filename TEXT NOT NULL,
  number INTEGER NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  dependencies TEXT,    -- JSON array of numbers
  description TEXT NOT NULL,
  context TEXT,
  result TEXT,
  review TEXT,
  blockers TEXT,
  -- Timing fields
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  phase_implementation_ms INTEGER,
  phase_review_ms INTEGER,
  phase_merge_ms INTEGER,
  phase_conflict_solver_ms INTEGER,
  PRIMARY KEY (project_name, task_folder, filename),
  FOREIGN KEY (project_name, task_folder)
    REFERENCES tasks(project_name, folder) ON DELETE CASCADE
);

-- Plans table (replaces .devsfactory/*/plan.md)
CREATE TABLE IF NOT EXISTS plans (
  project_name TEXT NOT NULL,
  task_folder TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  subtask_refs TEXT NOT NULL,  -- JSON array of SubtaskReference
  PRIMARY KEY (project_name, task_folder),
  FOREIGN KEY (project_name, task_folder)
    REFERENCES tasks(project_name, folder) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_name);
CREATE INDEX IF NOT EXISTS idx_subtasks_status ON subtasks(status);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(project_name, task_folder);
```

## File Structure

```
src/core/sqlite/
├── database.ts                    # SQLite connection, migrations, helpers
├── sqlite-project-registry.ts     # ProjectRegistryEmitter implementation
├── sqlite-task-storage.ts         # TaskStorageEmitter implementation
├── sqlite-project-registry.test.ts
├── sqlite-task-storage.test.ts
└── index.ts                       # Exports
```

## Implementation Details

### database.ts

- Uses `bun:sqlite` for native SQLite support
- WAL mode for concurrent read/write
- Foreign keys enabled
- Singleton pattern for shared database access
- Schema migrations on initialization

### SQLiteProjectRegistry

- Implements `ProjectRegistryEmitter` interface
- Polling at 500ms (configurable) for external change detection
- Hash-based comparison to detect updates
- Immediate event emission on local writes

### SQLiteTaskStorage

- Implements `TaskStorageEmitter` interface
- Scoped to `projectName` (passed in constructor)
- Factory method: `SQLiteTaskStorage.fromConfig(config)`
- Polling at 500ms for external change detection
- All queries include `WHERE project_name = ?`

## Integration Steps

1. **Create SQLite implementations**
   - `database.ts` with schema and helpers
   - `sqlite-project-registry.ts`
   - `sqlite-task-storage.ts`
   - Tests for both

2. **Update global-bootstrap.ts**
   - Initialize database on `ensureGlobalDir()`
   - Remove creation of `projects/`, `tasks/`, `brainstorm/` subdirs
   - Keep `worktrees/` and `logs/` (still file-based)

3. **Update consumers**
   - `MultiProjectRunner` → use `SQLiteProjectRegistry`
   - `Orchestrator` → use `SQLiteTaskStorage`

4. **Remove deprecated code**
   - `src/core/local/filesystem-project-registry.ts`
   - `src/core/local/filesystem-task-storage.ts`
   - `src/core/project-registry.ts`
   - `src/parser/*` (markdown parsing)

## Benefits

- **Cross-project queries**: `SELECT * FROM tasks WHERE status = 'PENDING'`
- **Unified dashboard**: Single query for all projects
- **Atomic transactions**: Status updates are atomic
- **No file parsing**: Faster than YAML/markdown parsing
- **Indexes**: Efficient filtering by status, project, etc.

## What Stays File-Based

- `~/.aop/config.yaml` - Global configuration (simple, rarely changes)
- `~/.aop/worktrees/` - Git worktrees (filesystem by nature)
- `~/.aop/logs/` - Agent logs (append-only, large files)
