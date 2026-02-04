## 1. Refactor CLI to Export Command Registration

- [x] 1.1 Extract command registration from `apps/cli/src/main.ts` into a `registerCommands(cli: CAC)` function that takes a `cac` instance and registers all commands (status, repo:init, repo:remove, task:ready, task:remove, apply, config:get, config:set)
- [x] 1.2 Extract `setupLogging` and `formatTimestamp` as named exports from `apps/cli/src/main.ts`
- [x] 1.3 Wrap the standalone execution in `if (import.meta.main)` block so importing the module has no side effects
- [x] 1.4 Update `apps/cli/package.json` exports to include `"./commands"` pointing to the new exports
- [x] 1.5 Verify `bun run apps/cli/src/main.ts` still works identically as a standalone CLI

## 2. Refactor Local-Server to Export startServer

- [x] 2.1 Create `apps/local-server/src/server.ts` extracting the server startup logic from `run.ts` into a `startServer(options?: ServerOptions): Promise<ServerHandle>` function
- [x] 2.2 Define `ServerOptions` type: `{ port?: number; dbPath?: string; dashboardStaticPath?: string }`
- [x] 2.3 Define `ServerHandle` type with a `shutdown(): Promise<void>` method that stops orchestrator, HTTP server, and destroys the DB connection
- [x] 2.4 Make `startServer` resolve only after the HTTP server is bound and orchestrator has started
- [x] 2.5 Make `startServer` reject with a descriptive error if the port is already in use
- [x] 2.6 Simplify `apps/local-server/src/run.ts` to import `startServer`, call it, and register SIGTERM/SIGINT handlers on the returned handle
- [x] 2.7 Update `apps/local-server/package.json` exports to include `"./server"` pointing to `./src/server.ts`
- [x] 2.8 Verify `bun run apps/local-server/src/run.ts` still works identically as a standalone server

## 3. Create Unified Entrypoint

- [x] 3.1 Create `scripts/installer/entrypoint.ts` that imports `registerCommands` from `@aop/cli` and `startServer` from `@aop/local-server`
- [x] 3.2 Register `run` command with `--daemon` option that calls `startServer` in foreground mode
- [x] 3.3 Register `stop` command that reads PID from `~/.aop/server.pid`, sends SIGTERM, and removes the PID file
- [x] 3.4 Call `registerCommands(cli)` to mount all existing CLI commands
- [x] 3.5 Add `declare const BUILD_VERSION: string` and wire it to `cli.version(BUILD_VERSION)`
- [x] 3.6 Implement daemon mode: when `--daemon` is passed, spawn `process.execPath run` as a detached process via `Bun.spawn`, write PID to `~/.aop/server.pid`, and exit
- [x] 3.7 Ensure `~/.aop/` directory is created on first run if it doesn't exist
- [x] 3.8 Configure logging to default to `~/.aop/logs/` when `AOP_LOG_DIR` is not set
- [x] 3.9 Resolve the embedded dashboard asset path (relative to `process.execPath`) and pass it as `dashboardStaticPath` to `startServer()` in the `run` command handler

## 4. Create Build Script

- [x] 4.1 Create `scripts/installer/build.ts` that uses `Bun.build()` API with `compile: true` and `minify: true`
- [x] 4.2 Define the 4 platform targets: `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-x64`, `bun-darwin-arm64`
- [x] 4.3 Read version from root `package.json` and short git commit hash, combine into `version+commit` format
- [x] 4.4 Pass version as `define: { "BUILD_VERSION": JSON.stringify(buildVersion) }` to each build
- [x] 4.5 Output binaries to `dist/release/aop-{os}-{arch}` (clean `dist/release/` before building)
- [x] 4.6 Generate `dist/release/checksums.sha256` using `Bun.CryptoHasher("sha256")` for each binary, in `<hash>  <filename>` format
- [x] 4.7 Support `--target` CLI argument to build only a single platform (for faster local iteration)
- [x] 4.8 Add `"build:release": "bun run ./scripts/installer/build.ts"` to root `package.json` scripts
- [x] 4.9 Add `dist/release/` to `.gitignore`
- [x] 4.10 Pre-build the dashboard (`bun run --filter @aop/dashboard build`) before binary compilation and verify `apps/dashboard/dist/index.html` exists
- [x] 4.11 Pass `apps/dashboard/dist/` as asset directory to `Bun.build()` so dashboard static files are embedded in the compiled binary

## 5. Create Install Script

- [x] 5.1 Create `scripts/installer/install.sh` as a POSIX-compatible shell script
- [x] 5.2 Implement OS detection via `uname -s` (Linux/Darwin) and arch detection via `uname -m` (x86_64/aarch64/arm64)
- [x] 5.3 Print error and exit for unsupported platforms
- [x] 5.4 Implement `--prefix` argument parsing for custom install directory
- [x] 5.5 Implement `--version` argument parsing to pin a specific version instead of latest
- [x] 5.6 Fetch latest version from `https://releases.aop.com/latest/version` (or use `--version`)
- [x] 5.7 Download binary from `https://releases.aop.com/v{version}/aop-{os}-{arch}` using `curl` (fall back to `wget`)
- [x] 5.8 Download `checksums.sha256` and verify binary integrity using `sha256sum` (fall back to `shasum -a 256`)
- [x] 5.9 Install to `/usr/local/bin/aop` if writable, otherwise `~/.local/bin/aop` (create directory if missing)
- [x] 5.10 Check for existing installation: print upgrade message with old/new version, or skip if same version
- [x] 5.11 Check for `git` and `claude` in PATH after installation, print warnings if missing
- [x] 5.12 Print success message with installed version and "Run 'aop run' to start"

## 6. Test and Verify

- [x] 6.1 Verify `bun run build:release -- --target linux-x64` produces a working binary in `dist/release/`
- [x] 6.2 Verify the compiled binary runs `aop --version` and prints the embedded version+commit
- [x] 6.3 Verify `aop run` starts the local-server and `aop status` returns data from it
- [x] 6.4 Verify `aop run --daemon` backgrounds the server and `aop stop` shuts it down
- [x] 6.5 Verify `aop stop` with no server running prints the expected message and exits cleanly
- [x] 6.6 Verify `bun run build:release` produces all 4 platform binaries and a valid checksums file
- [x] 6.7 Verify `bun check` passes (lint + typecheck + build)
- [x] 6.8 Verify existing tests pass with `bun test`
- [x] 6.9 Verify `aop run` serves the dashboard UI at `http://localhost:3847/` (embedded assets, no `DASHBOARD_STATIC_PATH` needed)
- [x] 6.10 Verify dashboard SPA routes (`/`, `/metrics`, `/tasks/:id`) all resolve correctly from the compiled binary
