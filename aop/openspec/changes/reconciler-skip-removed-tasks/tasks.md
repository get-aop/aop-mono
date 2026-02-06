## 1. Reconciler fix

- [ ] 1.1 In `reconcileRepo`, fetch all tasks (including REMOVED) for path-set building, then filter to active tasks in-memory for orphan removal
- [ ] 1.2 Update `createMissingTasks` to use the all-tasks path set so REMOVED change paths are skipped

## 2. Event emission guard

- [ ] 2.1 In `createIdempotent`, only emit `task-created` event when the task was actually inserted (not when returning an existing row)

## 3. Tests

- [ ] 3.1 Add reconciler test: REMOVED task path is skipped — no create attempt, accurate created count
- [ ] 3.2 Add reconciler test: new change with no existing task is still created as DRAFT
- [ ] 3.3 Add repository test: `createIdempotent` does not emit `task-created` when returning existing REMOVED task
