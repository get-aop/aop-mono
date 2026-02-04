## Why

AOP currently requires users to have Bun installed, clone the monorepo, run `bun install`, and manually start the local-server. This is acceptable for developers working on AOP itself, but unacceptable for end users who just want to orchestrate agents. Users should install AOP with a single `curl` command and have everything working — no Bun, no Node.js, no dependency management.

## What Changes

- **NEW**: Unified entrypoint (`scripts/installer/entrypoint.ts`) that combines CLI commands and local-server startup into a single binary
- **NEW**: Build script that uses `bun build --compile --minify` to produce standalone executables for linux-x64, linux-arm64, darwin-x64, darwin-arm64
- **NEW**: Install script (`install.sh`) for curl-based distribution that detects OS/arch and downloads the correct binary
- **NEW**: Dashboard static assets embedded in the compiled binary so the local-server serves the UI without external files
- **MODIFIED**: CLI `main.ts` exports its command registration so the unified entrypoint can reuse it
- **MODIFIED**: Local-server `run.ts` exports its startup logic so the unified entrypoint can invoke it
- **MODIFIED**: Build pipeline pre-builds the dashboard (`apps/dashboard`) and bundles its `dist/` output into the compiled binary
- Source code is minified inside the compiled binary to protect against casual reverse engineering

## Capabilities

### New Capabilities

- `unified-entrypoint`: Single TypeScript entrypoint that dispatches to either CLI commands or local-server startup based on the subcommand (`aop run` starts server, `aop stop` stops it, all other commands are CLI HTTP calls). Combines `apps/cli`, `apps/local-server`, and `apps/dashboard` into one process boundary.
- `build-pipeline`: Build script that pre-builds the dashboard to static files, then cross-compiles the unified entrypoint into standalone binaries for 4 platform targets using `bun build --compile --minify`. Embeds dashboard assets in the binary. Produces checksums for integrity verification.
- `install-script`: Shell script downloadable via `curl -fsSL https://aop.com/install.sh | bash`. Detects OS and architecture, downloads the correct binary from a release URL, places it in PATH, verifies checksum, and checks for prerequisites (Git 2.40+, Claude CLI).
- `dashboard-bundle`: The dashboard (`apps/dashboard`) is pre-built to static HTML/JS/CSS and embedded in the compiled binary. The local-server serves these assets automatically — no separate `DASHBOARD_STATIC_PATH` configuration needed for end users.

### Modified Capabilities

- `cli-commands`: CLI entrypoint (`apps/cli/src/main.ts`) refactored to export command registration as a reusable function, so the unified entrypoint can mount the same commands without duplicating them.
- `local-server`: Server startup logic (`apps/local-server/src/run.ts`) refactored to export a `startServer()` function callable from the unified entrypoint, rather than only running as a standalone script.

## Impact

- **Code**: New `scripts/installer/entrypoint.ts` — unified entrypoint (~50 lines)
- **Code**: New `scripts/installer/build.ts` — cross-compilation build script
- **Code**: New `scripts/installer/install.sh` — curl-installable shell script
- **Code**: `apps/cli/src/main.ts` — extract command registration into exportable function
- **Code**: `apps/local-server/src/run.ts` — extract `startServer()` function
- **Code**: `apps/dashboard/` — pre-built to static files and embedded in binary via `--asset-dir`
- **Code**: `scripts/installer/entrypoint.ts` — resolves embedded dashboard path and passes to `startServer`
- **Dependencies**: No new runtime dependencies (Bun's compile is built-in)
- **User experience**: Install via `curl`, run via `aop run`, dashboard accessible at `localhost:3847` — no Bun/Node/monorepo required
- **Security**: Minified source in compiled binary; workflow engine IP remains on cloud server
