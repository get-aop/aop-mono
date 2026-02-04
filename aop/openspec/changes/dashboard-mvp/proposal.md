## Why

AOP currently requires CLI-only task management, making it difficult to get a holistic view of the backlog across multiple repositories or monitor workflow execution progress. A visual dashboard enables faster triage, easier status tracking, and real-time visibility into agent execution logs.

## What Changes

- Add `apps/dashboard` React application for visual task management
- Add SSE endpoint to local-server for real-time agent log streaming
- Add API endpoints for task metrics (duration, success rates)
- Integrate dashboard static files into local-server for production distribution
- Update dev scripts for hot-reload dashboard development

## Capabilities

### New Capabilities
- `dashboard-ui`: React web application with task list, task detail views, filtering, and actions (mark ready, retry, abandon)
- `log-streaming`: SSE-based real-time streaming of agent execution logs from local-server to dashboard
- `task-metrics`: API endpoints and UI components for basic task metrics (duration, success/failure counts)

### Modified Capabilities
- `rest-server`: Add SSE endpoint for log streaming, add metrics endpoints, serve dashboard static files in production

## Impact

- **New app**: `apps/dashboard/` - React + Tailwind, built with Bun
- **Local server changes**: New SSE route, metrics handlers, static file serving
- **Build system**: Dashboard builds to static files, served by local-server
- **Dev scripts**: `bun dev` spins up dashboard with hot-reload alongside local-server
- **Dependencies**: React, Tailwind CSS (or similar styling solution)
