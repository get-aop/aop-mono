---
title: Terminal User Interface with OpenTUI
status: BACKLOG
created: 2026-01-25T00:00:00Z
priority: medium
tags: [tui, ui, opentui]
assignee: null
dependencies: [20260125180921-watcher-and-orchestrator]
---

## Description

Build the interactive terminal UI using OpenTUI with React. The TUI displays task state, shows active agents, and allows users to navigate and interact with the system. Follows the mockups in DESIGN.md.

## Requirements

### Components (`src/tui/components/`)

**`status-badge.tsx`**:

- Props: `{ status: TaskStatus | SubtaskStatus }`
- Map each status to symbol and color:
  - DONE: `✓` green
  - INPROGRESS: `●` yellow
  - PENDING: `○` gray
  - BLOCKED: `✗` red
  - REVIEW: `◉` blue
  - AGENT_REVIEW: `◎` cyan
  - DRAFT: `◇` dim
  - BACKLOG: `◆` dim
- Render using OpenTUI text component with fg color

**`progress-bar.tsx`**:

- Props: `{ completed: number; total: number; width?: number }`
- Render filled and empty blocks: `████░░░░ 4/8`
- Default width: 10 characters
- Handle edge cases: 0 total, completed > total

**`log-viewer.tsx`**:

- Props: `{ lines: string[]; maxLines?: number; height: number }`
- Render scrollable log display
- Auto-scroll to bottom on new lines
- Default maxLines: 100 (buffer limit)
- Show line numbers or timestamps

### Views (`src/tui/views/`)

**`task-list.tsx`** (Main View):

- Props: `{ tasks: Task[]; plans: Map<string, Plan>; activeAgents: AgentProcess[]; onSelectTask: (folder) => void; onQuit: () => void }`
- Layout matching DESIGN.md mockup:
  - Header: "devsfactory"
  - Task list with: status badge, folder name, priority, progress bar
  - Footer: Active agents section
  - Keybindings: `[↑↓] Navigate  [Enter] Drill down  [q] Quit`
- Use `useKeyboard()` hook for navigation
- Calculate progress from plan subtasks (completed/total)
- Sort tasks: INPROGRESS first, then by priority

**`task-detail.tsx`**:

- Props: `{ task: Task; plan: Plan | null; subtasks: Subtask[]; onSelectSubtask: (filename) => void; onBack: () => void }`
- Layout matching DESIGN.md mockup:
  - Header: task folder name
  - Status, priority, branch info
  - Subtask list with: status badge, number-slug, dependency info, commit SHA if DONE
  - Keybindings: `[Enter] View subtask  [l] Logs  [r] Review  [b] Back`
- Show dependency chain for blocked subtasks

**`subtask-detail.tsx`**:

- Props: `{ subtask: Subtask; agentLogs: string[]; onBack: () => void; onUnblock: () => void }`
- Layout matching DESIGN.md mockup:
  - Header: subtask filename
  - Status with attempt counter (e.g., "attempt 1/3")
  - Description section
  - Review issues if in AGENT_REVIEW (checkbox list)
  - Live agent logs if in INPROGRESS
  - Keybindings: `[l] Live logs  [r] Review history  [u] Unblock  [b] Back`

### Root App (`src/tui/app.tsx`)

- Define view state type: `'task-list' | 'task-detail' | 'subtask-detail'`
- Maintain navigation state with selected task/subtask
- Subscribe to orchestrator state updates
- Re-render views on state changes
- Handle view transitions with animation (optional)
- Implement `startApp(orchestrator: Orchestrator): Promise<void>`
  - Create OpenTUI renderer with `createCliRenderer()`
  - Create React root with `createRoot(renderer)`
  - Render `<App orchestrator={orchestrator} />`

### Keyboard Handling

- Use `useKeyboard()` hook from `@opentui/react`
- Global keybindings:
  - `q`: Quit application (confirm first?)
  - `l`: Toggle log viewer overlay
- View-specific keybindings as documented above
- Arrow keys for list navigation
- Enter for selection/drill-down
- `b` for back navigation

### Tests

- Component unit tests are challenging for TUI
- Focus on:
  - Status badge color mapping logic
  - Progress bar calculation
  - View state management logic
- Integration test: render with mock orchestrator state

## Acceptance Criteria

- [ ] StatusBadge renders correct symbols and colors for all statuses
- [ ] ProgressBar accurately shows completion percentage
- [ ] LogViewer scrolls and limits line buffer
- [ ] TaskListView displays all tasks with correct layout
- [ ] TaskListView shows active agents in footer
- [ ] TaskDetailView shows subtasks with dependencies
- [ ] SubtaskDetailView shows live logs during INPROGRESS
- [ ] Keyboard navigation works (arrows, enter, back)
- [ ] View transitions are smooth
- [ ] App subscribes to orchestrator and updates on state changes
- [ ] `startApp` successfully renders the TUI
- [ ] No TypeScript errors

## Notes

- OpenTUI uses React reconciler: `@opentui/react`
- Renderer created with `createCliRenderer()` from `@opentui/core`
- Use `<text>` elements for text rendering
- Colors specified as hex strings (e.g., `"#00FF00"`)
- Test manually in terminal during development

## Implemented PR Description
(filled by agent after completion)

{PR_TITLE}

{PR_DESCRIPTION}

