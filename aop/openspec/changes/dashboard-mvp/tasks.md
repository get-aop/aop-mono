## 1. Project Setup

- [x] 1.1 Create `apps/dashboard/` directory structure with package.json, tsconfig.json
- [x] 1.2 Configure Bun build for React + TypeScript + Tailwind CSS (extend theme with brand tokens from `brand/theme.md`)
- [x] 1.3 Create entry point files: index.html, main.tsx, App.tsx with routing
- [x] 1.4 Add dev script to root package.json for dashboard development with HMR
- [x] 1.5 Configure proxy from dashboard dev server to local-server API

## 2. API Client & SSE

- [x] 2.1 Create `apps/dashboard/src/api/client.ts` with fetch wrapper for local-server API
- [x] 2.2 Add typed API methods: getStatus(), markReady(), removeTask(), getMetrics()
- [x] 2.3 Create `apps/dashboard/src/api/events.ts` for SSE connection to `/api/events`
- [x] 2.4 Create `useTaskEvents` hook that manages SSE connection and provides task state
- [x] 2.5 Create `useSSE` hook for generic SSE connection (used for log streaming)
- [x] 2.6 Create `useConnectionStatus` hook that derives connection state (disconnected/idle/working) from SSE and task data

## 3. Brand & Theme Setup

- [x] 3.1 Add Jura, Instrument Sans, Geist Mono fonts to dashboard (CDN or local)
- [x] 3.2 Configure Tailwind theme with AOP color tokens (aop-black, aop-darkest, aop-dark, aop-charcoal, aop-cream, aop-amber, aop-working, aop-success, aop-blocked)
- [x] 3.3 Add Tailwind font family config: font-display (Jura), font-body (Instrument Sans), font-mono (Geist Mono)
- [x] 3.4 Create global CSS with page background (#0A0A0B) and base styles per theme.md
- [x] 3.5 Create Logo component (orchestrator dot + 3 agent dots, matching moodboard design)

## 4. Shared Components

- [x] 4.1 Create TaskCard component matching brand spec (dark bg, charcoal border, 4px radius, cream title, slate-dark repo in mono)
- [x] 4.2 Create StatusBadge component (colored dot + Geist Mono label per status colors)
- [x] 4.3 Create KanbanColumn component with status dot header and card list
- [x] 4.4 Create BlockedBanner component with red-tinted background per theme.md spec
- [x] 4.5 Create LogViewer component with auto-scroll and stdout/stderr styling in mono
- [x] 4.6 Create ConfirmDialog component for destructive actions
- [x] 4.7 Create ConnectionStatus component: gray circle (disconnected), pulsing dot (idle), rotating cog + shimmer text (working)
- [x] 4.8 Add shimmer CSS animation and workingStatuses array (50 messages from design.md)

## 5. Kanban Board View

- [x] 5.1 Create KanbanBoard view with four columns (DRAFT, READY, WORKING, DONE) on aop-black background
- [x] 5.2 Create header with Logo + "AOP" wordmark (Jura Light), capacity bar, and ConnectionStatus indicator (top-right)
- [x] 5.3 Wire up useTaskEvents hook to populate columns from SSE
- [x] 5.4 Add repository filter dropdown in header (styled per brand)
- [x] 5.5 Implement task card click to open detail panel

## 6. Blocked Banner

- [x] 6.1 Add BlockedBanner to KanbanBoard layout (conditionally rendered in footer)
- [x] 6.2 Display blocked task cards horizontally with error summary
- [x] 6.3 Add inline Retry and Remove action buttons (charcoal bg for Retry, outlined for Remove)
- [x] 6.4 Style per theme.md: blocked 8% bg, 30% top border, 50% card border

## 7. Task Detail View

- [x] 7.1 Create TaskDetail panel component (slide-over or modal) with darkest bg
- [x] 7.2 Display task info: status badge, timestamps in mono, change path, repo
- [x] 7.3 Display execution history with expandable step details
- [x] 7.4 Add action buttons: Mark Ready (amber for DRAFT), Remove (outlined)
- [x] 7.5 Integrate LogViewer for WORKING tasks with SSE connection to logs endpoint

## 8. Metrics Page

- [x] 8.1 Create MetricsPage view component with darkest card panels
- [x] 8.2 Display total tasks breakdown by status (large Jura numbers, mono labels)
- [x] 8.3 Display success rate (DONE / (DONE + BLOCKED))
- [x] 8.4 Display average duration for completed and failed tasks
- [x] 8.5 Add repository filter that updates metrics display
- [x] 8.6 Add navigation link to Metrics in header

## 9. Task Events Backend (SSE)

- [x] 9.1 Create event emitter for task status changes in orchestrator
- [x] 9.2 Create SSE endpoint `GET /api/events` in local-server
- [x] 9.3 Send `init` event with current state on connection
- [x] 9.4 Broadcast `task-created`, `task-status-changed`, `task-removed` events
- [x] 9.5 Implement heartbeat every 30 seconds

## 10. Log Streaming Backend

- [x] 10.1 Add log buffer data structure to executor (in-memory, 500 line limit)
- [x] 10.2 Capture agent stdout/stderr and push to buffer
- [x] 10.3 Create SSE endpoint `GET /api/executions/:executionId/logs` in local-server
- [x] 10.4 Implement log replay for late-joining clients
- [x] 10.5 Send completion event when execution finishes

## 11. Metrics Backend

- [x] 11.1 Add metrics calculation functions to task repository
- [x] 11.2 Create `GET /api/metrics` endpoint with task counts, success rate, avg duration
- [x] 11.3 Add optional `repoId` query param for per-repo filtering

## 12. Static File Serving

- [x] 12.1 Add `DASHBOARD_STATIC_PATH` environment variable support
- [x] 12.2 Add static file middleware to local-server for production
- [x] 12.3 Implement SPA fallback (serve index.html for non-API routes)
- [x] 12.4 Add CORS middleware for dashboard dev server origin

## 13. Build & Integration

- [x] 13.1 Create `bun build:dashboard` script for production build
- [x] 13.2 Update `bun dev` to start both local-server and dashboard dev server
- [x] 13.3 Verify production build serves correctly from local-server
- [x] 13.4 Add dashboard package to workspace dependencies

## 13. E2E Tests

**CRITICAL: Do NOT mark tasks complete until E2E tests pass. E2E tests MUST use real API calls, real agent execution, real workflow parsing. These are real-world use cases - NEVER use mocks. The entire environment must be running locally and working literally end-to-end.**

- [x] 13.1 Create E2E test suite for dashboard, happy path should be:
  - [x] 13.1.1 Create a new test repository with a fixture task
  - [x] 13.1.2 Verify task is not in DRAFT column
  - [x] 13.1.3 Mark task ready using the Dashboard UI
  - [x] 13.1.4 Verify task is in READY column
  - [x] 13.1.5 Verify task is in WORKING column
  - [x] 13.1.6 Verify task is in DONE column
  - [x] 13.1.7 Drill down into a complete task and view the execution history and agents logs
- [x] 13.2 Unhappy path, generate/reuse fixtures that can end up in all the status below:
  - [x] 13.2.1 Verify task is in BLOCKED column
  - [x] 13.2.2 Verify task is in REMOVED column
  - [x] 13.2.3 Verify task is in ABORTED column

**IMPORTANT**: You MUST evidence each step with screenshots using Playwright. After taking screenshots, you MUST read and display each screenshot file with its filename and file size. Skipping screenshot verification is unacceptable - if you cannot read/show the screenshots, the test is not complete.

## 14. Code Review Remediation

- [x] 14.1 Extract duplicate RepoFilter component from KanbanBoard.tsx and MetricsPage.tsx into shared `components/RepoFilter.tsx`
- [x] 14.2 Add integration tests for log-buffer.ts to improve coverage (currently 30.16% line coverage)
- [x] 14.3 Add tests for log-routes.ts SSE streaming and cleanup on abort (currently 62.22% line coverage)
- [x] 14.4 Add biome-ignore comments or update biome config to allow console usage in build scripts (apps/dashboard/build.ts)
- [x] 14.5 Unify SSE event protocol types in `@aop/common` - currently the backend (local-server) uses snake_case and one event shape, while the frontend (dashboard) expects camelCase and different shapes. Define shared types (Task, TaskEvent, InitEvent, etc.) in @aop/common that both can use, eliminating the fragile transformation layer in `apps/dashboard/src/api/events.ts`
- [x] 14.6 Persist agent logs to database instead of only streaming live - currently logs are only available via SSE while the agent is running, making it hard to inspect completed task logs. Store full execution logs so they can be retrieved for any task at any time.
- [x] 14.7 Add E2E test: open a DONE task and verify the execution log is displayed - click into a completed task's detail view and assert that the LogViewer shows the persisted agent output
- [x] 14.8 Add `cursor-pointer` to all clickable elements (TaskCard, nav links, action buttons) - currently the mouse pointer doesn't change on hover
