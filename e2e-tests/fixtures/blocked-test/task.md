---
title: Blocked Test
status: DRAFT
created: 2026-03-10T00:00:00.000Z
---

## Description
Fixture for testing blocked-task handling when the requested work is intentionally impossible.

## Requirements
- Attempt the impossible task defined by the fixture documents.
- Fail safely instead of inventing a successful result.

## Acceptance Criteria
- [ ] The execution ends in a blocked or failed state that requires user attention.
