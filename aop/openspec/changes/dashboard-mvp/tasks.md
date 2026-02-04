## 1. Project Setup

- [ ] 1.1 Create `apps/dashboard/` directory structure with package.json, tsconfig.json
- [ ] 1.2 Configure Bun build for React + TypeScript + Tailwind CSS (extend theme with brand tokens from `brand/theme.md`)
- [ ] 1.3 Create entry point files: index.html, main.tsx, App.tsx with routing
- [ ] 1.4 Add dev script to root package.json for dashboard development with HMR
- [ ] 1.5 Configure proxy from dashboard dev server to local-server API

## 2. API Client & SSE

- [ ] 2.1 Create `apps/dashboard/src/api/client.ts` with fetch wrapper for local-server API
- [ ] 2.2 Add typed API methods: getStatus(), markReady(), removeTask(), getMetrics()
- [ ] 2.3 Create `apps/dashboard/src/api/events.ts` for SSE connection to `/api/events`
- [ ] 2.4 Create `useTaskEvents` hook that manages SSE connection and provides task state
- [ ] 2.5 Create `useSSE` hook for generic SSE connection (used for log streaming)
- [ ] 2.6 Create `useConnectionStatus` hook that derives connection state (disconnected/idle/working) from SSE and task data

## 3. Brand & Theme Setup

- [ ] 3.1 Add Jura, Instrument Sans, Geist Mono fonts to dashboard (CDN or local)
- [ ] 3.2 Configure Tailwind theme with AOP color tokens (aop-black, aop-darkest, aop-dark, aop-charcoal, aop-cream, aop-amber, aop-working, aop-success, aop-blocked)
- [ ] 3.3 Add Tailwind font family config: font-display (Jura), font-body (Instrument Sans), font-mono (Geist Mono)
- [ ] 3.4 Create global CSS with page background (#0A0A0B) and base styles per theme.md
- [ ] 3.5 Create Logo component (orchestrator dot + 3 agent dots, matching moodboard design)

## 4. Shared Components

- [ ] 4.1 Create TaskCard component matching brand spec (dark bg, charcoal border, 4px radius, cream title, slate-dark repo in mono)
- [ ] 4.2 Create StatusBadge component (colored dot + Geist Mono label per status colors)
- [ ] 4.3 Create KanbanColumn component with status dot header and card list
- [ ] 4.4 Create BlockedBanner component with red-tinted background per theme.md spec
- [ ] 4.5 Create LogViewer component with auto-scroll and stdout/stderr styling in mono
- [ ] 4.6 Create ConfirmDialog component for destructive actions
- [ ] 4.7 Create ConnectionStatus component: gray circle (disconnected), pulsing dot (idle), rotating cog + shimmer text (working)
- [ ] 4.8 Add shimmer CSS animation and workingStatuses array (50 messages from design.md)

## 5. Kanban Board View

- [ ] 5.1 Create KanbanBoard view with four columns (DRAFT, READY, WORKING, DONE) on aop-black background
- [ ] 5.2 Create header with Logo + "AOP" wordmark (Jura Light), capacity bar, and ConnectionStatus indicator (top-right)
- [ ] 5.3 Wire up useTaskEvents hook to populate columns from SSE
- [ ] 5.4 Add repository filter dropdown in header (styled per brand)
- [ ] 5.5 Implement task card click to open detail panel

## 6. Blocked Banner

- [ ] 6.1 Add BlockedBanner to KanbanBoard layout (conditionally rendered in footer)
- [ ] 6.2 Display blocked task cards horizontally with error summary
- [ ] 6.3 Add inline Retry and Remove action buttons (charcoal bg for Retry, outlined for Remove)
- [ ] 6.4 Style per theme.md: blocked 8% bg, 30% top border, 50% card border

## 7. Task Detail View

- [ ] 7.1 Create TaskDetail panel component (slide-over or modal) with darkest bg
- [ ] 7.2 Display task info: status badge, timestamps in mono, change path, repo
- [ ] 7.3 Display execution history with expandable step details
- [ ] 7.4 Add action buttons: Mark Ready (amber for DRAFT), Remove (outlined)
- [ ] 7.5 Integrate LogViewer for WORKING tasks with SSE connection to logs endpoint

## 8. Metrics Page

- [ ] 8.1 Create MetricsPage view component with darkest card panels
- [ ] 8.2 Display total tasks breakdown by status (large Jura numbers, mono labels)
- [ ] 8.3 Display success rate (DONE / (DONE + BLOCKED))
- [ ] 8.4 Display average duration for completed and failed tasks
- [ ] 8.5 Add repository filter that updates metrics display
- [ ] 8.6 Add navigation link to Metrics in header

## 9. Task Events Backend (SSE)

- [ ] 9.1 Create event emitter for task status changes in orchestrator
- [ ] 9.2 Create SSE endpoint `GET /api/events` in local-server
- [ ] 9.3 Send `init` event with current state on connection
- [ ] 9.4 Broadcast `task-created`, `task-status-changed`, `task-removed` events
- [ ] 9.5 Implement heartbeat every 30 seconds

## 10. Log Streaming Backend

- [ ] 10.1 Add log buffer data structure to executor (in-memory, 500 line limit)
- [ ] 10.2 Capture agent stdout/stderr and push to buffer
- [ ] 10.3 Create SSE endpoint `GET /api/executions/:executionId/logs` in local-server
- [ ] 10.4 Implement log replay for late-joining clients
- [ ] 10.5 Send completion event when execution finishes

## 11. Metrics Backend

- [ ] 11.1 Add metrics calculation functions to task repository
- [ ] 11.2 Create `GET /api/metrics` endpoint with task counts, success rate, avg duration
- [ ] 11.3 Add optional `repoId` query param for per-repo filtering

## 12. Static File Serving

- [ ] 12.1 Add `DASHBOARD_STATIC_PATH` environment variable support
- [ ] 12.2 Add static file middleware to local-server for production
- [ ] 12.3 Implement SPA fallback (serve index.html for non-API routes)
- [ ] 12.4 Add CORS middleware for dashboard dev server origin

## 13. Build & Integration

- [ ] 13.1 Create `bun build:dashboard` script for production build
- [ ] 13.2 Update `bun dev` to start both local-server and dashboard dev server
- [ ] 13.3 Verify production build serves correctly from local-server
- [ ] 13.4 Add dashboard package to workspace dependencies
