## 1. Refactor execution record creation

- [ ] 1.1 Extract `createStepRecord` function from `createExecutionRecords` in `executor.ts`
- [ ] 1.2 Rename `createExecutionRecords` to `createExecutionRecord` (singular, creates execution only)
- [ ] 1.3 Move execution creation before the while loop in `executeTask`
- [ ] 1.4 Call `createStepRecord` inside the while loop for each step

## 2. Update execution finalization

- [ ] 2.1 Update `finalizeExecutionAndGetNextStep` to not close execution until workflow is done
- [ ] 2.2 Ensure execution status only changes to completed/failed on final step

## 3. Tests

- [ ] 3.1 Add test for multi-step workflow creating single execution with multiple steps
- [ ] 3.2 Update existing executor tests to match new behavior
