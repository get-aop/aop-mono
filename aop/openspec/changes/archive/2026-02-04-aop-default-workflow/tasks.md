## 1. Database Schema Changes

- [x] 1.1 Add migration for `iteration` column on executions table (INTEGER DEFAULT 0)
- [x] 1.2 Add migration for `visited_steps` column on executions table (TEXT, JSON array)
- [x] 1.3 Update `ExecutionsTable` type in schema.ts with new columns

## 2. Workflow Schema Extensions

- [x] 2.1 Extend `TransitionSchema` in types.ts with `maxIterations`, `onMaxIterations`, `afterIteration`, `thenTarget` optional fields
- [x] 2.2 Add validation for `onMaxIterations` and `thenTarget` referencing valid steps or terminal states
- [x] 2.3 Update YAML parser tests to cover new transition fields

## 3. Workflow Engine Iteration Logic

- [x] 3.1 Update execution creation to initialize `iteration` to 0 and `visited_steps` to empty array
- [x] 3.2 Add logic to track visited steps when entering a step
- [x] 3.3 Implement iteration increment when transitioning to previously-visited step
- [x] 3.4 Implement `maxIterations` check in transition evaluation (redirect to `onMaxIterations` when exceeded)
- [x] 3.5 Implement `afterIteration` conditional routing (use `thenTarget` when iteration >= afterIteration)
- [x] 3.6 Add tests for iteration tracking and max iterations enforcement
- [x] 3.7 Add tests for `afterIteration` conditional routing

## 4. Step Context Enhancement

- [x] 4.1 Add `iteration` field to step command generation (include in step context)
- [x] 4.2 Update protocol types in `@aop/common` to include `step.iteration`
- [x] 4.3 Update prompt template rendering to include `step.iteration` placeholder

## 5. Prompt Templates

- [x] 5.1 Replace `implement.md.hbs` with chunked implementation version (CHUNK_DONE, ALL_TASKS_DONE signals)
- [x] 5.2 Create `full-review.md.hbs` with thorough review checklist and REVIEW_PASSED/REVIEW_FAILED signals
- [x] 5.3 Create `fix-issues.md.hbs` with FIX_COMPLETE signal
- [x] 5.4 Create `quick-review.md.hbs` with AOP audit checklist and REVIEW_PASSED/REVIEW_FAILED signals

## 6. AOP Default Workflow

- [x] 6.1 Create `apps/server/workflows/aop-default.yaml` with implement, full-review, fix-issues, quick-review steps
- [x] 6.2 Verify workflow parses and validates correctly
- [x] 6.3 Add integration test for aop-default workflow execution flow

## 7. Backward Compatibility Verification

- [x] 7.1 Verify `simple.yaml` workflow continues working unchanged
- [x] 7.2 Verify `ralph-loop.yaml` workflow continues working unchanged
- [x] 7.3 Run full test suite to ensure no regressions

## 8. End-to-End Workflow Verification

- [x] 8.1 Create E2E test for aop-default workflow using `cli-greeting-command` fixture (verify implement -> review -> done flow)
