## 1. Setup

- [x] 1.1 Create `apps/server/workflows/` directory
- [x] 1.2 Add `yaml` package dependency to `apps/server/package.json`

## 2. YAML Workflow Files

- [x] 2.1 Create `apps/server/workflows/simple.yaml` with simple workflow definition
- [x] 2.2 Create `apps/server/workflows/ralph-loop.yaml` with ralph-loop workflow definition

## 3. YAML Parser

- [x] 3.1 Create `apps/server/src/workflow/yaml-parser.ts` with `parseWorkflowYaml()` function
- [x] 3.2 Add unit tests for YAML parsing (valid YAML, invalid syntax, invalid schema)

## 4. Workflow Loader

- [x] 4.1 Create `apps/server/src/workflow/workflow-loader.ts` with `loadWorkflowsFromDirectory()` function
- [x] 4.2 Add unit tests for directory loading (discover files, handle empty dir, handle missing dir)

## 5. Database Sync

- [x] 5.1 Add `upsert()` method to workflow repository
- [x] 5.2 Create `apps/server/src/workflow/workflow-sync.ts` with `syncWorkflows()` function
- [x] 5.3 Add unit tests for sync logic (insert new, update existing, preserve db-only)

## 6. Server Integration

- [x] 6.1 Call `syncWorkflows()` during server startup before accepting requests
- [x] 6.2 Add integration test verifying workflows are synced at startup

## 7. Migration Cleanup

- [x] 7.1 Remove workflow definition objects from `008-seed-simple-workflow.ts` (keep table structure migrations)
- [x] 7.2 Remove workflow definition objects from `010-seed-ralph-loop-workflow.ts`

## 8. Tests

- [x] 8.1 Verify existing workflow-parser tests still pass
- [x] 8.2 Verify existing workflow-state-machine tests still pass
- [x] 8.3 Run full test suite to ensure no regressions
