## Context

AOP's local-server exposes a REST API (Hono on Bun) that the CLI uses for task management. The server has SQLite with repos, tasks, executions, and step_executions tables. Currently there's no web UI - all interaction is CLI-based.

The dashboard will be a React SPA that communicates with the existing local-server API. For production, static files are bundled into local-server. For development, a separate dev server provides hot reload.

Constraints:
- Single developer use case (no auth needed)
- Must work with existing Hono/Bun stack
- Local-server already has task/repo/execution data via Kysely

## Goals / Non-Goals

**Goals:**
- Visual task management across all repos
- Real-time agent log streaming via SSE
- Basic metrics (task duration, success/failure counts)
- Hot-reload development experience
- Production: single binary serves both API and dashboard

**Non-Goals:**
- Multi-user authentication
- Persistent log storage (logs stream in real-time only)
- Advanced analytics or charting libraries
- Mobile-responsive design (desktop-first)

## Decisions

### 1. Dashboard as separate app with production bundling

**Choice**: `apps/dashboard/` as a standalone React app. In production, built static files are served by local-server. In development, Bun's dev server provides HMR.

**Alternatives considered:**
- Embed React in local-server directly → More complex build, harder to develop
- Separate always-running dashboard server → Extra process to manage

**Rationale**: Clean separation of concerns during development, single process in production.

### 2. Bun's built-in bundler for React

**Choice**: Use `Bun.build()` for bundling React + TypeScript. No Vite/Webpack.

**Rationale**: Consistent with CLAUDE.md guidance. Bun's bundler handles JSX, TypeScript, and CSS natively.

### 3. SSE for real-time updates

**Choice**: Server-Sent Events (SSE) for both task status updates and agent log streaming.

**SSE streams:**
- `GET /api/events` - Task status changes (task created, status changed, task removed)
- `GET /api/executions/:executionId/logs` - Agent log streaming

**Alternatives considered:**
- WebSockets → Bidirectional not needed, more complex
- Polling for status → Misses rapid state transitions, less responsive UX

**Rationale**: SSE is unidirectional server→client, simple to implement with Hono. Single connection for all task events keeps browser connection count low.

### 4. Kanban-style task board

**Choice**: Display tasks in a Kanban board with columns: DRAFT, READY, WORKING, DONE. BLOCKED tasks appear in a red footer banner (not a column).

**Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Filters: Repo ▾]                    [Metrics]   [Capacity: 2/3] │
├─────────────────────────────────────────────────────────────────┤
│   DRAFT        │    READY       │   WORKING     │     DONE      │
│  ┌──────────┐  │  ┌──────────┐  │  ┌──────────┐ │  ┌──────────┐ │
│  │ Task A   │  │  │ Task C   │  │  │ Task E   │ │  │ Task G   │ │
│  │ repo-1   │  │  │ repo-2   │  │  │ repo-1   │ │  │ repo-1   │ │
│  └──────────┘  │  └──────────┘  │  └──────────┘ │  └──────────┘ │
│  ┌──────────┐  │               │               │  ┌──────────┐ │
│  │ Task B   │  │               │               │  │ Task H   │ │
│  └──────────┘  │               │               │  └──────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ⚠️ BLOCKED: Task D (repo-1) - tests failed     [Retry] [Remove] │
└─────────────────────────────────────────────────────────────────┘
```

**Rationale**: Kanban gives immediate visual status. BLOCKED is exceptional state requiring attention - footer banner makes it prominent without taking column space.

### 5. Visual Design: Orchestral Precision

**Choice**: Implement the "Orchestral Precision" brand identity defined in `brand/`.

**Brand Reference Files:**
- `brand/design-philosophy.md` - Aesthetic manifesto
- `brand/theme.md` - Color tokens, typography, spacing, component specs
- `brand/moodboard.tsx` - Visual reference (renders moodboard.svg)

**Color Palette:**
| Token | Hex | Usage |
|-------|-----|-------|
| `aop-black` | `#0A0A0B` | Page background |
| `aop-darkest` | `#101012` | Card/panel backgrounds |
| `aop-dark` | `#18181B` | Elevated surfaces, headers |
| `aop-charcoal` | `#27272A` | Borders, dividers |
| `aop-cream` | `#FAFAF9` | Primary text |
| `aop-amber` | `#D97706` | Primary accent, READY state |
| `aop-working` | `#2563EB` | WORKING state |
| `aop-success` | `#059669` | DONE state |
| `aop-blocked` | `#DC2626` | BLOCKED state |

**Typography:**
- **Display**: Jura Light (headlines, large numbers, wordmark)
- **Body**: Instrument Sans (UI labels, descriptions)
- **Mono**: Geist Mono (code, IDs, status labels)

**Layout Principles:**
- 8px grid system for spacing
- Vast negative space (the "silence in music")
- Elements cluster at edges, leaving expanses for contemplation
- Color is information, not decoration

**Dashboard Layout (from moodboard):**
```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo+AOP]            [⚙ Orchestrating...]  [CAPACITY ██░░ 2/3]│  ← dark header
├─────────────────────────────────────────────────────────────────┤
│   ● DRAFT 2   │   ● READY 1   │   ● WORKING 1  │   ● DONE 2    │  ← dot + mono label + count
│  ┌──────────┐ │  ┌──────────┐ │  ┌──────────┐  │  ┌──────────┐ │
│  │ Task A   │ │  │ Task C   │ │  │ Task E   │  │  │ Task G   │ │  ← cream text, Instrument Sans
│  │ repo-1   │ │  │ repo-2   │ │  │ repo-1   │  │  │ repo-1   │ │  ← slate-dark, Geist Mono
│  └──────────┘ │  └──────────┘ │  │ ░░░░░░░  │  │  └──────────┘ │  ← progress bar for WORKING
│  ┌──────────┐ │              │  └──────────┘  │  ┌──────────┐ │
│  │ Task B   │ │              │                │  │ Task H   │ │
│  └──────────┘ │              │                │  └──────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ● BLOCKED 2                                                    │  ← red tinted section
│  ┌───────────────────────┐  ┌───────────────────────┐          │
│  │ Task D        [Retry] │  │ Task F        [Retry] │          │  ← horizontal blocked cards
│  │ repo — error [Remove] │  │ repo — error [Remove] │          │
│  └───────────────────────┘  └───────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
Background: aop-black (#0A0A0B)
```

**Component Specifications (from theme.md):**

*Task Card:*
- Background: dark (#18181B)
- Border: charcoal (#27272A) 1px
- Border-radius: 4px
- Padding: 16px
- Title: cream, Instrument Sans 14px
- Repo: slate-dark, Geist Mono 10px

*Status Badge:*
- Dot + Geist Mono 11px label
- Colors: charcoal (DRAFT), amber (READY), working blue (WORKING), success green (DONE), blocked red (BLOCKED)

*Blocked Section:*
- Background: blocked at 8% opacity
- Top border: blocked at 30% opacity
- Card border: blocked at 50% opacity

**Connection Status Indicator (top-right header):**

Three states with distinct visual treatments:

| State | Icon | Text | Style |
|-------|------|------|-------|
| Disconnected | Static circle | *(none)* | `aop-slate-dark` (#52525B), 50% opacity |
| Idle | Pulsing dot | *(none)* | `aop-amber` pulse (opacity 0.4→1→0.4, 2s ease-in-out) |
| Working | Rotating cog | Random status | `aop-amber` cog rotation + shimmer text |

*Working status messages* (50 options, randomized):
```typescript
const workingStatuses = [
  // Orchestral/scientific
  "Orchestrating...",
  "Conducting...",
  "Calibrating...",
  "Aligning...",
  "Synthesizing...",
  "Accumulating...",
  "Channeling...",
  "Harmonizing...",
  "Sequencing...",
  "Distilling...",
  "Abstracting...",
  "Indexing...",
  "Rendering...",
  "Parsing...",
  "Encoding...",
  // Poetic (2 words max)
  "Mapping void...",
  "Measuring silence...",
  "Breathing between...",
  "Charting flow...",
  "Tracing circuits...",
  "Crossing threshold...",
  "Consulting ether...",
  "Perceiving order...",
  "Weaving graphs...",
  "Curating chaos...",
  // Cryptic bytes/hex
  "0xCAFEBABE...",
  "0xDEADBEEF...",
  "0xC0FFEE...",
  "0xFF00FF...",
  "0x8BADF00D...",
  "0xFACEFEED...",
  "0xBAADF00D...",
  "0x1BADB002...",
  // Binary
  "10110010...",
  "11001001...",
  "01110011...",
  // Symbols
  "∿∿∿",
  "◈◈◈",
  "⟁⟁⟁",
  "∴∴∴",
  "⋮⋮⋮",
  // Cryptic words
  "Defragmenting...",
  "Coalescing...",
  "Interleaving...",
  "Transposing...",
  "Inverting...",
  "Permuting...",
  "Bifurcating...",
  "Reticulating...",
  "Entangling...",
];
```

*Shimmer effect*: CSS gradient that sweeps a translucent highlight across the text.
```css
.shimmer {
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 2s ease-in-out infinite;
  -webkit-background-clip: text;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**Rationale**: The brand kit establishes a distinctive visual identity ("Orchestral Precision") that elevates the dashboard from utilitarian tool to polished product. Dark theme reduces eye strain for developers. The connection status indicator adds personality while providing essential system feedback.

### 6. Tailwind CSS for styling

**Choice**: Tailwind CSS with custom theme extending the Orchestral Precision design tokens.

**Rationale**: Rapid UI development, no runtime CSS-in-JS overhead, works well with Bun bundler. Custom theme ensures consistency with brand.

### 7. Dashboard file structure

```
apps/dashboard/
  src/
    index.html          # Entry point
    main.tsx            # React root
    App.tsx             # Main app with routing
    api/                # API client
      client.ts         # Fetch wrapper
      events.ts         # SSE connection for task events
    components/         # Shared components
      TaskCard.tsx
      StatusBadge.tsx
      LogViewer.tsx
      KanbanColumn.tsx
      BlockedBanner.tsx
    views/              # Page-level components
      KanbanBoard.tsx   # Main task board view
      TaskDetail.tsx    # Task detail with logs
      MetricsPage.tsx   # Metrics dashboard
    hooks/              # Custom React hooks
      useTaskEvents.ts  # SSE hook for task status
      useSSE.ts         # Generic SSE hook
    types.ts            # Shared types
  package.json
  tsconfig.json
  tailwind.config.js
```

### 8. API additions to local-server

**New endpoints:**
- `GET /api/events` - SSE stream for task status changes
- `GET /api/executions/:executionId/logs` - SSE stream of agent logs
- `GET /api/metrics` - Aggregated task metrics

**Static file serving:**
- In production: `GET /*` serves from `apps/dashboard/dist/`
- Configured via environment variable `DASHBOARD_STATIC_PATH`

### 9. Development workflow

**Dev script updates:**
```bash
bun dev              # Starts local-server + dashboard dev server
bun dev:server       # Local-server only
bun dev:dashboard    # Dashboard with HMR only
bun build:dashboard  # Production build
```

Dashboard dev server proxies `/api/*` to local-server.

## Risks / Trade-offs

**[Log buffer size]** → Limit in-memory log buffer per execution (e.g., last 1000 lines). Older logs discarded.

**[SSE connection limits]** → Browser limit ~6 connections per domain. Use single `/api/events` for all task updates, open log stream only for actively viewed task.

**[Bundle size]** → Keep dependencies minimal. React + Tailwind only. No heavy charting libraries for MVP.

**[Dev server complexity]** → Proxy configuration adds setup. Mitigate with clear dev scripts and documentation.
