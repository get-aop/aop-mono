# AOP Product Roadmap

## Beyond v1.0: Developer Tools Platform

**Date**: 2026-01-28
**Status**: Planning
**Target**: v1.1+

---

## Table of Contents

1. [Vision](#1-vision)
2. [VS Code Extension Architecture](#2-vs-code-extension-architecture)
3. [Developer Tools Platform](#3-developer-tools-platform)
4. [Tool Specifications](#4-tool-specifications)
5. [Session Context Model](#5-session-context-model)
6. [Technical Architecture](#6-technical-architecture)
7. [Phased Delivery](#7-phased-delivery)

---

## 1. Vision

AOP evolves from a task orchestration system into a **developer tools platform** that integrates into the IDE. The tools provide standalone value while optionally linking to AOP task context.

```
┌─────────────────────────────────────────────────────────────────┐
│                    AOP Developer Tools                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Database   │  │  Debugger/  │  │   Task      │   ...more   │
│  │  Analyzer   │  │  Troubleshoot│  │  Orchestrator│            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          │                                      │
│                ┌─────────▼─────────┐                           │
│                │   Session Context  │ ◄── optional task link   │
│                │   (shared state)   │                           │
│                └─────────┬─────────┘                           │
│                          │                                      │
│                ┌─────────▼─────────┐                           │
│                │   Claude Session   │ ◄── user's Claude sub    │
│                │   (bidirectional)  │                           │
│                └───────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Approach

| Factor | Benefit |
|--------|---------|
| **Standalone value** | Tools work without AOP orchestration (wider adoption) |
| **Natural upsell** | "This found 5 issues, create tasks to fix them?" |
| **Context continuity** | Debug session findings flow into task requirements |
| **Daily use** | Devs use tools constantly, not just for big tasks |
| **Differentiator** | Cursor/Windsurf don't have this integrated tooling |

---

## 2. VS Code Extension Architecture

The extension uses a **hybrid approach**: native VS Code components where possible, WebView (styled to feel native) for complex UI.

### 2.1 Native vs. WebView Decision Matrix

| Feature | Native Possible? | Approach |
|---------|-----------------|----------|
| Task list | Yes | TreeView in sidebar |
| Subtask status | Yes | TreeView with icons |
| Agent status | Yes | StatusBar item |
| Quick actions | Yes | Command Palette |
| Logs/output | Yes | Output Channel |
| Task creation form | Partial | Multi-step QuickPick or WebView |
| Chat interface | No | WebView (styled native) |
| Plan review + graph | No | WebView (styled native) |
| Dependency visualization | No | WebView (styled native) |
| Database schema view | No | WebView (styled native) |
| Debugger session | No | WebView (styled native) |

### 2.2 Native Feel Techniques

#### VS Code CSS Variables

WebViews automatically adapt to user's theme:

```css
body {
  background-color: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.input {
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
}

.button-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
```

#### Webview UI Toolkit

Microsoft's [@vscode/webview-ui-toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit) provides components that exactly match VS Code's native look:

```tsx
import {
  VSCodeButton,
  VSCodeTextField,
  VSCodeTextArea,
  VSCodeDropdown,
  VSCodeOption,
  VSCodeCheckbox,
  VSCodeProgressRing,
  VSCodePanels,
  VSCodePanelTab,
  VSCodePanelView,
  VSCodeDataGrid,
  VSCodeDataGridRow,
  VSCodeDataGridCell,
} from '@vscode/webview-ui-toolkit/react';
```

### 2.3 Native UI Examples

#### Sidebar with TreeViews (100% Native)

```
┌─────────────────────────────────┐
│ AOP                        ≡ ⋮ │
├─────────────────────────────────┤
│ ▼ TASKS                         │
│   ▼ 🔵 Add user authentication  │
│       ◉ 001-setup-jwt (done)    │
│       ◐ 002-login-endpoint      │
│       ○ 003-refresh-token       │
│   ▶ ⚪ Implement dark mode      │
├─────────────────────────────────┤
│ ▼ RUNNING AGENTS                │
│   🤖 impl-002 (2m 34s)          │
│   🤖 review-001 (45s)           │
└─────────────────────────────────┘
```

#### Status Bar (100% Native)

```
┌────────────────────────────────────────────────────────────────┐
│ main  ↑2 ↓0  │  AOP: 2 agents running  │  ✓ 3/7 subtasks     │
└────────────────────────────────────────────────────────────────┘
```

#### Chat Panel (WebView, styled native)

```
┌─────────────────────────────────────────┐
│ AOP Planning                        ✕   │
├─────────────────────────────────────────┤
│                                         │
│  You: Add user authentication           │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │ AOP: What auth method?             │ │
│  │ • JWT with refresh tokens          │ │
│  │ • Session-based                    │ │
│  │ • OAuth2                           │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Type a message...              ➤│   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 2.4 Connection Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  VS Code Extension                                          │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ TreeViews   │    │ StatusBar   │    │ WebView     │     │
│  │ (native)    │    │ (native)    │    │ Panels      │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                │
│                   ┌────────▼────────┐                       │
│                   │ WebSocketClient │                       │
│                   │ (extension.ts)  │                       │
│                   └────────┬────────┘                       │
└────────────────────────────┼────────────────────────────────┘
                             │ ws://localhost:3000
                             │
┌────────────────────────────▼────────────────────────────────┐
│  Local Dashboard Server (@aop/orchestrator)                 │
│  - Already running when user does `aop start`               │
│  - Same WebSocket protocol as browser dashboard             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Developer Tools Platform

### 3.1 Core Concept

Every tool:
- Works **standalone** (no AOP task required)
- Can **link to a task** for context sharing
- Uses **Claude session** for AI-powered analysis
- Can **create tasks** from findings

### 3.2 Planned Tools

| Tool | Purpose | Standalone Value | Task Integration |
|------|---------|------------------|------------------|
| **Debugger/Troubleshooter** | Interactive debugging with Claude | Debug any issue | Link findings to task |
| **Database Analyzer** | Schema analysis, query optimization | Find N+1, missing indexes | Create optimization tasks |
| **Code Health Scanner** | Security, performance, tech debt | Continuous scanning | Bulk task creation |
| **API Explorer** | Endpoint discovery, testing | API documentation | Generate test tasks |

---

## 4. Tool Specifications

### 4.1 Debugger / Troubleshooting Session

Interactive debugging sessions powered by Claude that can read logs, code, and database state.

```
┌─────────────────────────────────────────────────────────────┐
│ Troubleshooting Session                                ─ □ ✕│
│ 🔗 Linked to: Task #42 - Fix checkout flow                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ You: Users are getting 500 errors on checkout               │
│                                                             │
│ Claude: Let me investigate. I'll check:                     │
│ 1. Recent error logs                                        │
│ 2. The checkout endpoint code                               │
│ 3. Database state                                           │
│                                                             │
│ ┌─ Reading src/api/checkout.ts ────────────────────────────┐│
│ │ Found potential issue at line 67:                        ││
│ │ `await stripe.charges.create(...)` - no error handling   ││
│ └──────────────────────────────────────────────────────────┘│
│                                                             │
│ ┌─ Checking logs ──────────────────────────────────────────┐│
│ │ [ERROR] StripeInvalidRequestError: Invalid card token    ││
│ │ Occurred 47 times in last hour                           ││
│ └──────────────────────────────────────────────────────────┘│
│                                                             │
│ Claude: The Stripe integration is failing because expired   │
│ card tokens aren't being handled. Here's the fix:           │
│                                                             │
│ [View Diff] [Apply Fix] [Add to Task #42] [Create New Task] │
├─────────────────────────────────────────────────────────────┤
│ 💬 ___________________________________________________  [➤] │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Interactive debugging with Claude (reads logs, code, DB)
- Link to existing task (context shared)
- Spawn subtask from findings
- Session saved for later reference
- Integrates with VS Code debug protocol (breakpoints, variables)

### 4.2 Database Analyzer

Schema introspection, query analysis, and optimization suggestions.

```
┌─────────────────────────────────────────────────────────────┐
│ Database Analyzer                                      ─ □ ✕│
├─────────────────────────────────────────────────────────────┤
│ Connection: postgresql://localhost:5432/myapp    [Refresh]  │
├─────────────────────────────────────────────────────────────┤
│ ▼ Schema Overview                                           │
│   ├── users (12 columns, 45k rows)                         │
│   │   └── ⚠️ Missing index on email (used in 3 queries)    │
│   ├── orders (8 columns, 120k rows)                        │
│   │   └── ⚠️ N+1 detected: orders→users (23 occurrences)   │
│   └── products (15 columns, 2k rows)                       │
├─────────────────────────────────────────────────────────────┤
│ 💬 Ask about your database...                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ "Why is the orders query slow?"                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Claude: Looking at your orders table, I see the query at    │
│ src/api/orders.ts:45 joins users without an index on        │
│ orders.user_id. Adding this index should help:              │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ CREATE INDEX idx_orders_user_id ON orders(user_id);     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                        [Apply] [Create Task]│
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Schema introspection (Kysely/Drizzle/Prisma schema or raw SQL)
- Query analysis (find N+1, missing indexes, slow queries)
- Visual ERD generation
- Migration suggestions
- **"Create Task"** spawns AOP task to implement the fix

### 4.3 Code Health Scanner

Continuous scanning for security issues, performance problems, and technical debt.

```
┌─────────────────────────────────────────────────────────────┐
│ Code Health                                            ─ □ ✕│
├─────────────────────────────────────────────────────────────┤
│ Last scan: 2 hours ago                           [Rescan]   │
├─────────────────────────────────────────────────────────────┤
│ ⚠️  Technical Debt (3 items)                                │
│   └── Duplicated auth logic in 4 files         [Create Task]│
│   └── Deprecated API usage (lodash _.pluck)    [Create Task]│
│   └── Missing error boundaries in React        [Create Task]│
│                                                             │
│ 🔒 Security (1 item)                                        │
│   └── SQL injection risk in search.ts:34      [Create Task] │
│                                                             │
│ 🚀 Performance (2 items)                                    │
│   └── Unoptimized images (4.2MB total)        [Create Task] │
│   └── Bundle size: react-icons (240KB)        [Create Task] │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Security vulnerability scanning
- Performance issue detection
- Technical debt identification
- Bulk task creation from findings
- Scheduled background scans

### 4.4 API Explorer / Tester

Endpoint discovery, documentation, and test generation.

```
┌─────────────────────────────────────────────────────────────┐
│ API Explorer                                           ─ □ ✕│
├─────────────────────────────────────────────────────────────┤
│ Endpoints (auto-discovered from routes)                     │
│ ├── GET  /api/users           [Test]                       │
│ ├── POST /api/users           [Test]                       │
│ ├── GET  /api/users/:id       [Test]                       │
│ └── ...                                                     │
├─────────────────────────────────────────────────────────────┤
│ 💬 "Generate integration tests for the users endpoints"     │
│                                                             │
│ Claude: I'll create tests covering:                         │
│ - CRUD operations                                           │
│ - Validation errors                                         │
│ - Auth requirements                                         │
│                                                             │
│ [View Generated Tests] [Create Task to Implement]           │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Auto-discover endpoints from code (Hono, Express, Next.js)
- Interactive API testing
- OpenAPI spec generation
- Test generation with Claude
- Task creation for test implementation

---

## 5. Session Context Model

### 5.1 Core Types

```typescript
interface ToolSession {
  id: string;
  tool: 'database' | 'debugger' | 'health' | 'api';

  // Optional task link
  linkedTask?: {
    taskId: string;
    taskFolder: string;
    subtaskId?: string;  // Can link to specific subtask
  };

  // Claude conversation for this session
  claudeSession: ClaudeSession;

  // Tool-specific state
  state: DatabaseState | DebuggerState | HealthState | ApiState;

  // Actions taken (for audit/replay)
  actions: SessionAction[];

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

### 5.2 Task Linking

```typescript
// Link session to task at any point
async function linkToTask(session: ToolSession, taskId: string) {
  session.linkedTask = { taskId, taskFolder: `tasks/${taskId}` };
  // Claude now has task context in system prompt
  await session.claudeSession.updateContext({ task: await loadTask(taskId) });
}

// Create task from session findings
async function createTaskFromSession(session: ToolSession, title: string) {
  const task = await aopClient.createTask({
    title,
    description: generateDescription(session),
    linkedSession: session.id,  // Back-reference
  });
  await linkToTask(session, task.id);
}
```

### 5.3 Session Persistence

Sessions are persisted locally for:
- Resuming interrupted debugging
- Referencing past investigations
- Linking multiple sessions to same task
- Audit trail of changes

---

## 6. Technical Architecture

### 6.1 Directory Structure

```
apps/
+-- vscode/
    +-- src/
    |   +-- extension.ts              # Extension entry point
    |   +-- tools/                    # Tool implementations
    |   |   +-- database/
    |   |   |   +-- DatabaseTool.ts   # Tool controller
    |   |   |   +-- SchemaProvider.ts # TreeView provider
    |   |   |   +-- analyzers/        # Query analyzer, index suggester
    |   |   +-- debugger/
    |   |   |   +-- DebuggerTool.ts
    |   |   |   +-- LogReader.ts
    |   |   |   +-- SessionManager.ts
    |   |   +-- health/
    |   |   |   +-- HealthTool.ts
    |   |   |   +-- scanners/         # Security, perf, debt scanners
    |   |   +-- api/
    |   |       +-- ApiTool.ts
    |   |       +-- RouteDiscovery.ts
    |   +-- core/
    |   |   +-- ToolRegistry.ts       # Register/manage tools
    |   |   +-- SessionContext.ts     # Shared context (task link, project)
    |   |   +-- ClaudeSession.ts      # Bidirectional Claude CLI
    |   |   +-- TaskIntegration.ts    # Create/link tasks from tools
    |   +-- providers/
    |   |   +-- TaskTreeProvider.ts   # AOP task management (native TreeView)
    |   |   +-- AgentTreeProvider.ts  # Running agents (native TreeView)
    |   +-- statusbar/
    |   |   +-- AgentStatusBar.ts     # Native status bar
    |   +-- views/
    |   |   +-- ChatViewProvider.ts   # Shared chat WebView
    |   |   +-- DatabaseViewProvider.ts
    |   |   +-- DebuggerViewProvider.ts
    |   +-- client/
    |       +-- WebSocketClient.ts    # Connects to local dashboard server
    +-- webview-ui/                   # React app for WebView panels
    |   +-- src/
    |   |   +-- components/           # Shared UI (from packages/ui)
    |   |   +-- tools/
    |   |   |   +-- database/
    |   |   |   +-- debugger/
    |   |   |   +-- health/
    |   |   |   +-- api/
    |   |   +-- index.tsx
    |   +-- package.json
    +-- package.json                  # Extension manifest
    +-- tsconfig.json
```

### 6.2 Package Dependencies

```
apps/vscode ────────► @aop/common         (types, interfaces)
     │
     ├──────────────► @aop/ui             (React components)
     │
     ├──────────────► @aop/orchestrator   (Claude session, WebSocket)
     │
     └──────────────► @aop/llm-providers  (Claude CLI/API providers)
```

### 6.3 Extension Manifest (package.json)

```json
{
  "name": "aop-vscode",
  "displayName": "AOP Developer Tools",
  "description": "AI-powered developer tools with task orchestration",
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "aop",
        "title": "AOP",
        "icon": "resources/aop-icon.svg"
      }]
    },
    "views": {
      "aop": [
        { "id": "aop.tasks", "name": "Tasks" },
        { "id": "aop.agents", "name": "Running Agents" },
        { "id": "aop.tools", "name": "Tools" }
      ]
    },
    "commands": [
      { "command": "aop.createTask", "title": "AOP: Create Task" },
      { "command": "aop.startDebugSession", "title": "AOP: Start Debugging Session" },
      { "command": "aop.analyzeDatabase", "title": "AOP: Analyze Database" },
      { "command": "aop.scanCodeHealth", "title": "AOP: Scan Code Health" },
      { "command": "aop.exploreApi", "title": "AOP: Explore API" }
    ]
  }
}
```

---

## 7. Phased Delivery

### Phase Overview

| Phase | Version | Deliverable | Timeline |
|-------|---------|-------------|----------|
| **1** | v1.0 | Browser dashboard + orchestration | Current |
| **2** | v1.1 | VS Code extension with task management | +2-3 weeks |
| **3** | v1.2 | Debugger/Troubleshooting tool | +2 weeks |
| **4** | v1.3 | Database Analyzer | +2 weeks |
| **5** | v1.4 | Code Health Scanner | +2 weeks |
| **6** | v2.0 | Full tools platform | +4 weeks |

### v1.1: VS Code Extension (Task Management)

**Scope:**
- Native TreeView for tasks and agents
- Status bar with agent status
- WebView for chat/planning (reuse dashboard components)
- Connect to local dashboard server via WebSocket

**Dependencies:**
- v1.0 complete (dashboard, orchestration)
- packages/ui extracted for component reuse

### v1.2: Debugger/Troubleshooting Tool

**Scope:**
- Interactive debugging sessions with Claude
- Log reading and analysis
- Code inspection
- Task linking and creation
- Session persistence

**Why first:**
- Highest standalone value
- Most differentiated from competitors
- Natural entry point to AOP ecosystem

### v1.3: Database Analyzer

**Scope:**
- Schema introspection (multiple ORMs)
- Query analysis
- N+1 detection
- Index suggestions
- Task creation for fixes

### v1.4: Code Health Scanner

**Scope:**
- Security scanning
- Performance analysis
- Technical debt detection
- Bulk task creation

### v2.0: Full Platform

**Scope:**
- Tool marketplace/plugin system
- Custom tool development
- Team sharing of sessions
- Analytics dashboard

---

## Appendix: Comparison with Competitors

| Feature | AOP | Cursor | Windsurf | GitHub Copilot |
|---------|-----|--------|----------|----------------|
| Task orchestration | ✅ | ❌ | ❌ | ❌ |
| Multi-agent execution | ✅ | ❌ | ❌ | ❌ |
| Integrated debugger | ✅ (planned) | ❌ | ❌ | ❌ |
| Database analyzer | ✅ (planned) | ❌ | ❌ | ❌ |
| Code health scanner | ✅ (planned) | ❌ | ❌ | ❌ |
| Session-task linking | ✅ (planned) | ❌ | ❌ | ❌ |
| Uses user's Claude sub | ✅ | ❌ | ❌ | ❌ |
