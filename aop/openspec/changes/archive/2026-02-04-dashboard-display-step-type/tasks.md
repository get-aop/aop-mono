## 1. API Layer

- [ ] 1.1 Update executions endpoint to include step data by calling `getStepExecutionsByExecutionId` for each execution
- [ ] 1.2 Transform step execution records to API response format (stepType, status, startedAt, endedAt, error)
- [ ] 1.3 Add Step type to dashboard types.ts

## 2. Dashboard UI

- [ ] 2.1 Update Execution type in dashboard to include steps array
- [ ] 2.2 Create StepList component to display steps with type badges, status, and timing
- [ ] 2.3 Integrate StepList into ExecutionHistory component (show when execution is expanded)

## 3. Testing

- [ ] 3.1 Add API test for executions endpoint returning steps
- [ ] 3.2 Add component test for StepList rendering step types and statuses
