## Context

The reconciler (`reconcile.ts`) runs on a periodic tick and a file-watcher trigger. It scans `openspec/changes/` directories across all watched repos, creates DRAFT tasks for new changes, and marks tasks as REMOVED when their change directory disappears.

Currently, the reconciler fetches only active (non-REMOVED) tasks to build its "already known" set. When a user removes a task from the dashboard (setting status to REMOVED), the reconciler no longer sees that task in its active set, re-detects the change on disk, and calls `createIdempotent`. The DB row isn't duplicated (idempotent upsert), but the reconciler incorrectly counts and logs it as "created" every cycle.

## Goals / Non-Goals

**Goals:**
- REMOVED tasks are skipped during reconciliation — no re-processing, no misleading logs
- Accurate reconciliation metrics (created/removed counts reflect actual changes)

**Non-Goals:**
- Changing the task removal mechanism (soft-delete via REMOVED status stays as-is)
- Adding a "re-activate" flow for REMOVED tasks (separate concern)
- Changing `createIdempotent` semantics beyond event emission guard

## Decisions

### 1. Fetch all task paths (including REMOVED) for the skip check

**Choice**: Load all tasks for the repo (no `excludeRemoved` filter) to build the path set, then filter to active tasks for orphan removal.

**Alternatives considered:**
- **Separate query for REMOVED paths only** — Extra DB call for minimal benefit. A single unfiltered query is simpler.
- **`createIdempotent` returns null for REMOVED tasks** — Would mask the real issue (reconciler shouldn't be calling create at all for known changes). Also changes `createIdempotent` semantics which other callers may depend on.

**Rationale**: The reconciler already queries tasks for the repo. Removing the `excludeRemoved` filter from the path-building query is a one-line change with zero additional DB cost. Active tasks are filtered in-memory for orphan removal.

### 2. Guard `task-created` event in `createIdempotent`

**Choice**: Only emit `task-created` when the task was actually inserted (not when returning an existing row).

**Rationale**: `createIdempotent` currently emits `task-created` even when it finds an existing REMOVED task and returns it unchanged. This is a latent bug — downstream listeners (SSE, dashboard) shouldn't receive creation events for tasks that already exist. The fix is to only emit on actual insert.

## Risks / Trade-offs

- **[Low] Orphan removal scope narrowed** — `removeOrphanedTasks` will only process active tasks (not REMOVED), which is correct since REMOVED tasks are already in terminal state. No behavioral change.
- **[Low] Single query returns more rows** — Fetching REMOVED tasks adds negligible overhead (typically few REMOVED tasks per repo).
