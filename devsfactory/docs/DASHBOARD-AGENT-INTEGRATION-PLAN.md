# Dashboard Agent Integration Plan

## Goal

Create a simple dashboard where users can:
1. Connect/disconnect a local agent via button click
2. Create tasks via input field
3. Monitor agent activity in real-time

All communication happens via WebSocket to the orchestrator.

## Architecture

```
Terminal:
$ aop server
  └── Orchestrator + Dashboard Server (localhost:3001)
            │
            │ WebSocket (/api/events)
            ▼
Browser (http://localhost:3001):
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard                                                       │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Agent: [Disconnected]  [Connect Agent] [Disconnect Agent]  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Create Task: [________________________] [Create]           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │ Tasks                   │  │ Agent Activity              │  │
│  │ - add-auth (INPROGRESS) │  │ > Working on 001-setup.md   │  │
│  │ - fix-bug (PENDING)     │  │ > [Read: src/auth.ts]       │  │
│  └─────────────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
            │
            │ API calls (POST /api/local-agent/start, etc.)
            ▼
Dashboard Server:
  └── Spawns/kills local agent process
  └── Agent connects back via WebSocket (/api/agents)
```

## Implementation Steps

### Phase 1: Backend API Endpoints

**File: `src/core/dashboard-server.ts`**

Add local agent process management:

```typescript
// Add to DashboardServer class
private localAgentProcess: Subprocess | null = null;

// New endpoints:
// POST /api/local-agent/start - spawns agent process
// POST /api/local-agent/stop - kills agent process
// GET /api/local-agent/status - returns { status: 'connected' | 'disconnected' }
// POST /api/tasks/create - creates task with { description: string, projectName?: string }
```

**Changes needed:**
1. Add `localAgentProcess` field to track spawned agent
2. Add `handleStartLocalAgent()` method - spawns `aop agent --server ws://localhost:PORT/api/agents`
3. Add `handleStopLocalAgent()` method - kills the process
4. Add `handleGetLocalAgentStatus()` method - checks if process alive + agent connected
5. Add `handleCreateTask()` method - calls create-task logic
6. Add route matching in `handleRequest()`
7. Enable remote agent mode by default (so local agent can connect)

### Phase 2: Dashboard Store Updates

**File: `packages/dashboard/store.ts`**

Add local agent state:

```typescript
interface DashboardStore {
  // ... existing fields

  // Local agent state
  localAgentStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  localAgentError: string | null;

  // Actions
  startLocalAgent: () => Promise<void>;
  stopLocalAgent: () => Promise<void>;
  createTask: (description: string) => Promise<void>;
}
```

### Phase 3: Dashboard API Client

**File: `packages/dashboard/api.ts`**

Add new API methods:

```typescript
interface ApiClient {
  // ... existing methods

  startLocalAgent(): Promise<{ success: boolean }>;
  stopLocalAgent(): Promise<{ success: boolean }>;
  getLocalAgentStatus(): Promise<{ status: string }>;
  createTaskSimple(description: string, projectName?: string): Promise<{ taskFolder: string }>;
}
```

### Phase 4: Dashboard UI Components

**File: `packages/dashboard/components/AgentControl.tsx`** (new)

Simple agent control panel:

```tsx
export const AgentControl = () => {
  const status = useDashboardStore((s) => s.localAgentStatus);
  const startAgent = useDashboardStore((s) => s.startLocalAgent);
  const stopAgent = useDashboardStore((s) => s.stopLocalAgent);

  return (
    <div className="agent-control">
      <span className={`agent-status ${status}`}>
        Agent: {status}
      </span>
      <button onClick={startAgent} disabled={status === 'connected'}>
        Connect Agent
      </button>
      <button onClick={stopAgent} disabled={status === 'disconnected'}>
        Disconnect Agent
      </button>
    </div>
  );
};
```

**File: `packages/dashboard/components/CreateTaskForm.tsx`** (new)

Simple task creation form:

```tsx
export const CreateTaskForm = () => {
  const [description, setDescription] = useState('');
  const createTask = useDashboardStore((s) => s.createTask);

  const handleSubmit = async () => {
    if (description.trim()) {
      await createTask(description);
      setDescription('');
    }
  };

  return (
    <div className="create-task-form">
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe your task..."
      />
      <button onClick={handleSubmit}>Create Task</button>
    </div>
  );
};
```

**File: `packages/dashboard/components/Header.tsx`** (update)

Add AgentControl and CreateTaskForm to header:

```tsx
export const Header = () => {
  return (
    <header className="header">
      <h1>Devsfactory</h1>
      <AgentControl />
      <CreateTaskForm />
      {/* ... existing elements */}
    </header>
  );
};
```

### Phase 5: WebSocket Event Updates

**File: `src/core/dashboard-server.ts`**

Broadcast local agent status changes:

```typescript
// When agent connects via /api/agents WebSocket:
this.broadcast({ type: 'localAgentConnected' });

// When agent disconnects:
this.broadcast({ type: 'localAgentDisconnected' });
```

**File: `packages/dashboard/store.ts`**

Handle new events in `updateFromServer()`:

```typescript
case 'localAgentConnected':
  set({ localAgentStatus: 'connected' });
  break;

case 'localAgentDisconnected':
  set({ localAgentStatus: 'disconnected' });
  break;
```

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/core/dashboard-server.ts` | Modify | Add local agent management + task creation API |
| `packages/dashboard/api.ts` | Modify | Add new API client methods |
| `packages/dashboard/store.ts` | Modify | Add local agent state + actions |
| `packages/dashboard/types.ts` | Modify | Add new event types |
| `packages/dashboard/components/AgentControl.tsx` | Create | Agent connect/disconnect buttons |
| `packages/dashboard/components/CreateTaskForm.tsx` | Create | Simple task creation input |
| `packages/dashboard/components/Header.tsx` | Modify | Include new components |

## API Endpoints

| Endpoint | Method | Request Body | Response |
|----------|--------|--------------|----------|
| `/api/local-agent/start` | POST | `{}` | `{ success: boolean }` |
| `/api/local-agent/stop` | POST | `{}` | `{ success: boolean }` |
| `/api/local-agent/status` | GET | - | `{ status: 'connected' \| 'disconnected' }` |
| `/api/tasks/create` | POST | `{ description: string, projectName?: string }` | `{ taskFolder: string }` |

## WebSocket Events (New)

| Event | Direction | Payload |
|-------|-----------|---------|
| `localAgentConnected` | Server → Client | `{ type: 'localAgentConnected' }` |
| `localAgentDisconnected` | Server → Client | `{ type: 'localAgentDisconnected' }` |
| `taskCreated` | Server → Client | `{ type: 'taskCreated', taskFolder: string }` |

## Testing Plan

1. Start server: `aop server`
2. Open browser: http://localhost:3001
3. Click "Connect Agent" → agent should start and connect
4. Enter task description → click "Create Task" → task should appear
5. Agent should pick up task and start working
6. Activity feed should show agent output
7. Click "Disconnect Agent" → agent should stop

## Future Improvements

- Better error handling and display
- Agent health monitoring
- Multiple agent support
- Task queue visualization
- Agent resource usage display
