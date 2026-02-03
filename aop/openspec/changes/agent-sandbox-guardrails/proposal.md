## Why

AI agents (claude-code, etc.) running in git worktrees can execute arbitrary git commands, potentially escaping their isolation or bypassing AOP's PR workflow. Without guardrails, an agent could `git checkout main`, `git push origin HEAD`, or navigate outside its worktree, corrupting the main repo or pushing unreviewed code.

## What Changes

- Add validation that trunk branches (main, master) have push protection enabled before starting workflows
- Add pre-flight checks before agent execution to verify worktree isolation
- Document operational requirements (protected branches) in user-facing docs
- (Future) Explore git hooks or filesystem sandboxing for active enforcement

## Capabilities

### New Capabilities
- `agent-sandbox`: Pre-flight validation and runtime guardrails for agent execution in worktrees. Includes trunk protection verification and worktree isolation checks.

### Modified Capabilities
<!-- None - this is additive -->

## Impact

- **git-manager**: May need to expose worktree validation utilities
- **llm-provider**: May need pre-execution hooks for validation
- **CLI**: Must check repository protection settings before enabling workflows
- **Documentation**: Must clearly state "protected trunk" as a prerequisite
