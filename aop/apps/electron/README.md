# AOP Desktop App

Electron-based desktop application for AOP (Agents Operating Platform).

## Architecture

The desktop app uses an Electron + Bun sidecar architecture:

- **Main Process (Node.js)**: Handles window management, auto-updates, system tray
- **Bun Server (Sidecar)**: Compiled Bun binary that runs the local-server HTTP API
- **Dashboard**: React SPA served by the Bun server and loaded in the BrowserWindow

```
┌────────────────────────────────────────────────────────┐
│                    Electron App                        │
│                        (~150MB)                        │
│                                                        │
│  ┌──────────────────┐         ┌─────────────────────┐  │
│  │   Main Process   │  spawn  │   Bun Server        │  │
│  │   (Node.js)      │────────▶│   (compiled bin)    │  │
│  │                  │         │   (~40MB)           │  │
│  │  - Auto-updater  │         │   - HTTP :3847      │  │
│  │  - Tray icon     │         │   - SQLite          │  │
│  │  - Lifecycle     │         │   - Orchestrator    │  │
│  └────────┬─────────┘         └──────────┬──────────┘  │
│           │                              │             │
│           │ loadURL('http://127.0.0.1:PORT')            │
│           ▼                              │             │
│  ┌──────────────────┐                    │             │
│  │   BrowserWindow  │◀─────HTTP──────────┘             │
│  │   (Dashboard)    │                                  │
│  └──────────────────┘                                  │
└────────────────────────────────────────────────────────┘
```

## Development

### Prerequisites

- Bun v1.3.6+
- Node.js 18+ (for electron-forge)

### Setup

```bash
# Install dependencies (from monorepo root)
bun install

# The electron app uses symlinks to the monorepo's node_modules
```

### Commands

```bash
# Start in development mode
bun run start

# Build dependencies (sidecar + dashboard) and package
bun run make

# Build for distribution (includes all makers)
bun run build

# Type check
bun run typecheck
```

## Build Pipeline

1. **Build sidecar**: Compiles `apps/local-server/src/run.ts` to standalone binary
2. **Build dashboard**: Builds React app to `apps/dashboard/dist/`
3. **Package**: electron-forge packages both into the app resources
4. **Make**: Creates platform-specific installers (DMG, NSIS, AppImage)

## Configuration

### Forge Config (`forge.config.ts`)

- **Makers**: DMG (macOS), Wix/NSIS (Windows), AppImage (Linux)
- **Extra Resources**: Includes `aop-server` binary and `dashboard/` static files
- **Code Signing**: Configured for macOS notarization and Windows signing

### Environment Variables

The main process sets these when spawning the Bun server:

- `AOP_ELECTRON_SIDECAR=1` - Enables sidecar mode (JSON logging, port discovery)
- `AOP_DB_PATH` - Path to SQLite database in user's data directory
- `DASHBOARD_STATIC_PATH` - Path to built dashboard files

## Port Discovery

The Bun server tries ports 3847-3899 and announces the actual port via stdout:

```
AOP_SERVER_PORT=3848
```

The Electron main process parses this to know which URL to load.

## Auto-Updates

Uses `electron-updater` with GitHub Releases:

- Checks for updates on app launch
- Downloads in background
- Notifies user when update is ready
- Installs on restart

## Project Structure

```
apps/electron/
  src/
    main.ts          # Main process (spawn server, lifecycle)
    preload.ts       # Context bridge (IPC)
    tray.ts          # System tray management
    updater.ts       # Auto-update logic
    index.html       # Loading page (shown before server ready)
    renderer.ts      # Renderer process entry
  assets/
    icon.icns        # macOS app icon
    icon.ico         # Windows app icon
    icon.png         # Linux app icon
    tray-icon.png    # Tray icon (color)
    tray-iconTemplate.png  # Tray icon (template for macOS)
  forge.config.ts    # electron-forge configuration
  package.json
  tsconfig.json
  webpack.*.config.ts
```

## Troubleshooting

### Port conflicts

If ports 3847-3899 are all in use, the app shows an error dialog and exits.

### Server crash

If the Bun server crashes, the UI shows an error with a "Restart Server" button.

### Anti-virus

On Windows, the compiled Bun binary may trigger false positives. Code signing reduces this but some users may need to add an exception.
