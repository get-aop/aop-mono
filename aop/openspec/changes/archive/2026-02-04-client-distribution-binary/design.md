## Context

AOP's local components (CLI + local-server) currently run from source inside the monorepo via `bun run`. This works for developers but blocks end-user adoption — users shouldn't need Bun, the monorepo, or `bun install` to use AOP. The CLI and local-server need to ship as a single self-contained binary that users install via a one-liner.

Bun provides `bun build --compile` which produces standalone executables embedding the Bun runtime. Combined with `--minify`, this gives us distribution binaries with casual reverse-engineering protection. The real IP (workflow engine) stays on the cloud server.

## Goals / Non-Goals

**Goals:**

- Single `aop` binary containing CLI + local-server + dashboard + SQLite
- Cross-platform builds for linux/darwin, x64/arm64
- `curl | bash` installation with platform detection and checksum verification
- Minified source inside compiled binary
- Existing development workflow (`bun run` from source) continues working

**Non-Goals:**

- Windows support (Bun compile doesn't support Windows yet)
- Auto-update mechanism (future work)
- Code signing or notarization (future work, needed for macOS Gatekeeper)
- GitHub Actions CI pipeline for automated releases (separate change)
- Distribution via package managers (brew, apt — future work)

## Decisions

### 1. Unified Entrypoint Location: `scripts/installer/entrypoint.ts`

**Decision**: Place the unified entrypoint in `scripts/installer/` rather than creating a new app.

**Rationale**: The entrypoint is a thin wrapper (~50 lines) that imports from `apps/cli` and `apps/local-server`. It's build infrastructure, not a new application. The `scripts/` workspace already exists for dev tooling. Creating an `apps/dist/` would imply it's a standalone app when it's just glue code.

**Alternatives considered**:

- `apps/dist/`: Implies a full application; this is just a build entrypoint
- Root-level `entrypoint.ts`: Clutters the repo root
- Inside `apps/cli/`: CLI is a thin HTTP client; mixing server startup into it muddies its purpose

### 2. Command Routing via `cac` Subcommands

**Decision**: The unified entrypoint creates one `cac` instance, registers `run` and `stop` as new commands, then calls `registerCommands()` from `apps/cli` to mount all existing CLI commands on the same instance.

```typescript
import cac from "cac";
import { registerCommands } from "@aop/cli";
import { startServer } from "@aop/local-server";

const cli = cac("aop");

cli
  .command("run", "Start the local server")
  .option("--daemon", "Run in background")
  .action(async (options) => {
    /* start server */
  });

cli.command("stop", "Stop the local server").action(async () => {
  /* stop server */
});

registerCommands(cli);

cli.help();
cli.version(BUILD_VERSION);
cli.parse();
```

**Rationale**: Reuses the existing `cac` library already in use. `registerCommands` is a pure function that takes a `cac` instance — no duplication, no side effects. The `run` and `stop` commands are entrypoint-specific and don't belong in `apps/cli`.

**Alternatives considered**:

- Two separate binaries (`aop` + `aop-server`): More complex distribution, user has to manage two things
- Process.argv[2] switch statement: Reinvents command routing that `cac` already handles

### 3. Daemon Mode via `Bun.spawn` with `detached`

**Decision**: `aop run --daemon` spawns the same binary with `aop run` as a detached subprocess, writes the PID, and exits.

```typescript
if (options.daemon) {
  const proc = Bun.spawn([process.execPath, "run"], {
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  writePidFile(proc.pid);
  proc.unref();
  process.exit(0);
}
```

**Rationale**: The compiled binary is its own executable. `Bun.spawn` with `detached: true` and `unref()` is the standard way to background a process in Bun/Node. PID file at `~/.aop/server.pid` enables `aop stop` to find it.

**Alternatives considered**:

- systemd/launchd only: Not cross-platform, higher friction for first-time users
- `nohup` wrapper in shell: Fragile, shell-dependent
- In-process backgrounding (fork): Not supported in Bun compiled binaries

### 4. Refactoring Strategy: Extract Functions, Keep Files

**Decision**: Modify `apps/cli/src/main.ts` and `apps/local-server/src/run.ts` to extract reusable functions, but keep the files as working standalone entrypoints.

For CLI:

```typescript
// apps/cli/src/main.ts
export const registerCommands = (cli: CAC): void => {
  /* existing commands */
};
export const setupLogging = async (): Promise<void> => {
  /* existing logic */
};

// Still works standalone:
if (import.meta.main) {
  const cli = cac("aop");
  registerCommands(cli);
  // ...
}
```

For local-server:

```typescript
// apps/local-server/src/server.ts (new file, extracted from run.ts)
export const startServer = async (
  options?: ServerOptions
): Promise<ServerHandle> => {
  // existing logic from run.ts main()
};

// apps/local-server/src/run.ts (kept as standalone entrypoint)
import { startServer } from "./server.ts";
const handle = await startServer();
process.on("SIGTERM", () => handle.shutdown());
```

**Rationale**: Development workflow stays unchanged — `bun run apps/cli/src/main.ts` and `bun run apps/local-server/src/run.ts` continue working. The unified entrypoint imports the extracted functions. No circular dependencies.

**Alternatives considered**:

- Move all logic to unified entrypoint: Breaks dev workflow, can't run apps independently
- Re-export from package.json only: Doesn't address the side-effect-on-import problem

### 5. Version Injection via `--define`

**Decision**: Use Bun's `--define` flag to inject version at compile time.

```typescript
// Build script
const version = pkg.version;
const commit = execSync("git rev-parse --short HEAD").toString().trim();
const buildVersion = `${version}+${commit}`;

await Bun.build({
  entrypoints: ["./scripts/installer/entrypoint.ts"],
  define: { BUILD_VERSION: JSON.stringify(buildVersion) },
  minify: true,
  compile: true,
  target: `bun-${target}`,
});
```

```typescript
// entrypoint.ts
declare const BUILD_VERSION: string;
cli.version(BUILD_VERSION);
```

**Rationale**: `--define` replaces identifiers at compile time — no runtime file reads, no external version files. Standard pattern used by esbuild, webpack, and Bun's bundler.

**Alternatives considered**:

- Read `package.json` at runtime: Not available in compiled binary (no filesystem source)
- Hardcode version in entrypoint: Forgettable, out of sync
- Environment variable: Not embedded, user could override accidentally

### 6. Build Script as TypeScript, Not Shell

**Decision**: Write the build script in TypeScript (`scripts/installer/build.ts`) using Bun APIs.

**Rationale**:

- `Bun.build()` API is programmatic — cleaner than shelling out to `bun build` CLI multiple times
- Checksum generation uses `Bun.CryptoHasher` — no dependency on `sha256sum` availability
- Cross-platform target iteration is a simple array loop
- Error handling with try/catch, not `set -e`

**Alternatives considered**:

- Shell script: Harder to maintain, `sha256sum` vs `shasum` differences across platforms
- Makefile: Not in the project's toolchain (Bun scripts are)

### 7. Install Script Download URL Pattern

**Decision**: Binaries hosted at `https://releases.aop.com/v{version}/aop-{os}-{arch}` with checksums at `https://releases.aop.com/v{version}/checksums.sha256`. The install script fetches `https://releases.aop.com/latest/version` to discover the current version.

**Rationale**: Version-prefixed URLs enable pinning specific versions (`curl ... | bash -s -- --version 0.2.0`). A `/latest/version` endpoint avoids hardcoding versions in the install script. GitHub Releases could serve as the CDN initially.

**Alternatives considered**:

- GitHub Releases only: Requires parsing GitHub API for latest release, adds complexity
- npm/bun registry: Requires package manager installed, defeats the purpose
- S3 direct: No CDN caching, higher latency

### 8. Dashboard Embedding via Bun's Asset Directory

**Decision**: Pre-build the dashboard to static files and embed them in the compiled binary using Bun's `--asset-dir` flag. The unified entrypoint resolves the embedded asset path and passes it to `startServer()` as `dashboardStaticPath`.

**Build sequence**:

```typescript
// scripts/installer/build.ts — before binary compilation
// 1. Build dashboard
await Bun.$`bun run --filter @aop/dashboard build`;

// 2. Compile binary with embedded dashboard assets
await Bun.build({
  entrypoints: ["./scripts/installer/entrypoint.ts"],
  compile: true,
  minify: true,
  assets: { dir: "./aop/apps/dashboard/dist" },
  // ...
});
```

**Entrypoint resolution**:

```typescript
// scripts/installer/entrypoint.ts
import path from "path";

// In compiled binary, assets are relative to the executable
const dashboardPath = path.join(path.dirname(process.execPath), "dashboard");

cli.command("run", "Start the local server").action(async (options) => {
  await startServer({
    dashboardStaticPath: dashboardPath,
    // ...
  });
});
```

**Rationale**: Bun's `--asset-dir` flag is designed exactly for this — embedding static files into compiled binaries. The dashboard is already built as static HTML/JS/CSS via `apps/dashboard/build.ts`. The local-server already supports `dashboardStaticPath` as a config option, so no server changes are needed — just pass the path from the entrypoint.

**Alternatives considered**:

- **Inline dashboard as base64 strings**: Too complex, loses file-based serving
- **Download dashboard separately**: Defeats the single-binary goal
- **Serve dashboard from a CDN**: Requires internet, not self-contained
- **Keep `DASHBOARD_STATIC_PATH` as user config**: Unacceptable UX for end users — the dashboard should just work out of the box

### 9. Data Directory: `~/.aop/`

**Decision**: All persistent state lives under `~/.aop/`:

- `~/.aop/aop.sqlite` — SQLite database (already the default from `getDefaultDbPath()`)
- `~/.aop/server.pid` — PID file for daemon mode
- `~/.aop/logs/` — Log files

**Rationale**: This is already the convention — `getDefaultDbPath()` returns `~/.aop/aop.sqlite`. We're formalizing it as the canonical data directory. All overrides remain via environment variables (`AOP_DB_PATH`, `AOP_LOG_DIR`).

**Alternatives considered**:

- XDG Base Directory (`~/.local/share/aop`): More correct on Linux, but `~/.aop` is simpler and already established
- Platform-specific (`~/Library/Application Support/aop`): Complexity for no real benefit at this stage

## Risks / Trade-offs

**[Bun compile stability]** → `bun build --compile` is relatively mature but less battle-tested than Go/Rust binaries. Mitigation: CI smoke tests run the compiled binary on each platform.

**[Binary size]** → Compiled Bun binaries are ~90MB because they embed the full runtime. Dashboard assets add a few MB (minified JS/CSS/HTML). Mitigation: Acceptable for a CLI tool. Compression in transit helps. No alternative without switching runtimes.

**[Minification is not encryption]** → Determined reverse engineers can extract and beautify the embedded JS. Mitigation: The real IP (workflow engine, prompts) lives on the cloud server. Local code is orchestration plumbing.

**[Cross-compilation requires matching Bun version]** → `bun build --compile --target=bun-linux-arm64` cross-compiles from any host. Works today but depends on Bun maintaining this capability.

**[No auto-update]** → Users must re-run the install script to update. Mitigation: `aop --version` shows current version. Future: `aop update` command.

**[macOS Gatekeeper]** → Unsigned binaries trigger "unidentified developer" warnings on macOS. Mitigation: Document `xattr -d com.apple.quarantine ./aop` workaround. Future: Apple Developer certificate signing.
