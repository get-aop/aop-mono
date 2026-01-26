---
title: Sample Feature Implementation
status: BACKLOG
created: 2026-01-25T00:00:00Z
priority: high
tags: [sample, test]
assignee: null
dependencies: []
---

## Description

A sample task for e2e testing the git worktree manager.

## Requirements

- Subtask 001 has no dependencies
- Subtask 002 depends on 001
- Subtask 003 depends on both 001 and 002
- This creates a linear dependency chain for testing merge order

## Acceptance Criteria

- [ ] All subtasks complete successfully
- [ ] Worktrees are created and removed correctly
- [ ] Merges happen in dependency order

## Notes

This task is used for integration testing purposes only.
