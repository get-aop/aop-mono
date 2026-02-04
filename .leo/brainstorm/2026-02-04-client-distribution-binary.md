# Client Distribution: Single Compiled Bun Binary

## Summary

Distribute AOP to end users as a single compiled+minified Bun binary. Users install via a curl one-liner. The binary contains the CLI + local-server + SQLite — everything needed to run AOP locally. No Docker, no Bun, no Node.js required on the user's machine.

## User Experience

```bash
# Install
curl -fsSL https://aop.com/install.sh | bash

# Run
aop run          # Starts local-server as background process
aop status       # CLI commands talk to localhost:3847
aop repo:init    # Register a repo
```

## Architecture

```
Single `aop` binary (compiled Bun executable)
├── CLI commands (thin HTTP client)
├── local-server (Hono + SQLite + orchestrator + executor)
├── @aop/common, @aop/infra, @aop/git-manager, @aop/llm-provider
└── Embedded Bun runtime (includes bun:sqlite)
```

**User's machine prerequisites:**
- Git 2.40+
- Claude CLI (for agent execution)

**What connects where:**
- CLI → local-server on localhost:3847 (in-process or local HTTP)
- local-server → api.aop.dev (cloud workflow engine)

## Build Strategy

**`bun build --compile --minify`** produces a standalone executable:
- Embeds Bun runtime (user doesn't install Bun)
- Minified source (obfuscation against reverse engineering)
- Single file, no node_modules
- Platform-specific binaries: linux-x64, linux-arm64, darwin-x64, darwin-arm64

### Build Pipeline

1. **Single entrypoint** that combines CLI + local-server
   - `aop run` → starts local-server (background process)
   - `aop stop` → stops local-server
   - `aop <command>` → CLI HTTP calls to local-server
2. **Compile**: `bun build --compile --minify --target=bun-linux-x64 ./src/entrypoint.ts --outfile aop`
3. **Cross-compile** for all platform targets
4. **Distribute** via install script that detects OS/arch and downloads correct binary

### Install Script (`install.sh`)

- Detect OS (linux/darwin) and arch (x64/arm64)
- Download correct binary from releases/CDN
- Place in `/usr/local/bin/aop` (or `~/.local/bin/aop`)
- Verify checksum
- Print success + prerequisites check (git, claude CLI)

## Reverse Engineering Protection

- **Minification**: Variable names mangled, code compressed
- **Compiled binary**: Source embedded in executable, not plain-text files
- **Real IP on server**: Workflow engine, prompt library, analytics all run on api.aop.dev — the local binary is orchestration plumbing
- **Acceptable risk**: Determined attackers can extract embedded JS, but the valuable IP (workflows) never leaves the cloud

## Key Design Decisions

1. **Single binary (CLI + local-server combined)** — simpler distribution, one thing to install
2. **No Docker dependency** — lower barrier to entry, faster startup
3. **SQLite embedded via bun:sqlite** — no external database to manage
4. **Background process for local-server** — `aop run` starts it, `aop stop` stops it (or systemd/launchd service)
5. **Cross-platform** — Bun supports linux and macOS, x64 and arm64

## Open Questions

- **Auto-update mechanism**: How does the binary update itself? (curl again, or built-in `aop update`?)
- **Where to store SQLite DB**: `~/.aop/data.db`? XDG dirs?
- **Service management**: Should `aop run` daemonize itself, or recommend systemd/launchd service file?
- **Claude CLI auth**: User needs to have authenticated Claude CLI before `aop run` — install script should check/warn
