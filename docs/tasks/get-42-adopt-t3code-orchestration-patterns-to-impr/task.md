---
id: task_812f526cbd8b
title: Adopt t3code orchestration patterns to improve AOP performance and precision
status: DRAFT
created: 2026-03-14T06:18:17.130Z
changePath: docs/tasks/get-42-adopt-t3code-orchestration-patterns-to-impr
priority: medium
tags:
  - linear
  - get
  - aop
  - adopt
  - t3code
  - orchestration
  - patterns
  - improve
  - performance
  - and
  - precision
source:
  provider: linear
  id: a9eb13a1-4d7f-4c6a-a5ae-6208a03e1f7d
  ref: GET-42
  url: https://linear.app/get-aop/issue/GET-42/adopt-t3code-orchestration-patterns-to-improve-aop-performance-and
dependencySources: []
dependencyImported: false
---

## Description
Imported from Linear `GET-42`.

## Context

We completed a three-pass deep scan of `~/work/t3code` and documented the findings in:

* `docs/superpowers/research/2026-03-13-t3code-investigation-log.md`
* `docs/superpowers/research/2026-03-13-t3code-aop-recommendations.md`

The main conclusion is that `t3code` is outperforming bare Codex mostly through runtime architecture, not prompt tricks.

## Why This Matters

`t3code` is getting better operational results from Codex because it adds:

* an explicit orchestration command/event spine
* canonical provider runtime events
* dedicated reactors for runtime ingestion, provider commands, and checkpoints
* projection-backed read models
* stronger provider session recovery
* provider health/readiness checks
* deterministic integration harnesses
* hardened process/git/runtime support infrastructure

AOP already has strong repo-local task docs and workflow ownership. The opportunity is to keep that advantage while upgrading the runtime around execution.

## Goal

Enhance AOP’s orchestrator/runtime so tasks execute with better determinism, better recovery, stronger observability, and more precise live state.

## Proposed Workstreams

### 1\. Event spine

* Add explicit orchestration commands/events for task claim, step start, step completion, pause, block, retry, resume, and runtime failure
* Add command receipts or equivalent idempotency tracking for queue-triggered actions

### 2\. Runtime normalization

* Define an AOP-owned canonical provider runtime event schema
* Normalize Codex/Claude runtime signals into stable event types for approvals, tool activity, plans, progress, user input, and runtime errors

### 3\. Reactor split

* Separate provider command dispatch, runtime ingestion, and verification/checkpoint work into focused reactors
* Reduce direct recursive flow between queue, workflow service, and executor

### 4\. Projection-backed status

* Build an orchestration read model optimized for dashboard/CLI
* Project task/session/step/dependency/activity state into durable read-side storage

### 5\. Recovery model

* Persist provider binding and recoverable runtime metadata per active execution
* Improve restart/reattach behavior with explicit session state instead of heuristics only

### 6\. Provider health/readiness

* Add startup health probes for local providers
* Surface provider availability/auth/version readiness before dispatching work

### 7\. Integration harnesses

* Add orchestration integration harnesses with repo fixtures, fake provider runtime, sqlite state, and lifecycle assertions
* Cover restart/recovery and checkpoint scenarios deterministically

### 8\. Runtime support hardening

* Centralize subprocess policy: timeout, buffer limits, truncation, kill semantics
* Strengthen git/worktree service boundaries
* Apply cache/concurrency caps to repeated repo scans

## Acceptance Criteria

- [ ] A concrete AOP architecture plan exists for the event spine, runtime normalization, projections, and recovery model
- [ ] The first implementation slice is defined so another agent can begin execution without redoing the research
- [ ] Provider health/readiness and integration harness requirements are included in scope, not deferred into “later maybe”
- [ ] The work preserves AOP’s repo-local task-doc model instead of replacing it with chat-thread semantics

## Notes

This should be treated as an AOP architecture upgrade initiative, not a prompt-tuning task. The research strongly suggests the biggest gains will come from execution/runtime design rather than changing prompts or models alone.


- Team: Get-aop (GET)
- Project: AOP
- State: Todo

## Requirements
- Fix the requested behavior described in `GET-42`.
- Review https://linear.app/get-aop/issue/GET-42/adopt-t3code-orchestration-patterns-to-improve-aop-performance-and.

## Acceptance Criteria
- [ ] The implementation matches the behavior requested in GET-42.
- [ ] Relevant verification for this change passes.
