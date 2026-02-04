## ADDED Requirements

### Requirement: Dashboard pre-build step
The build pipeline SHALL build the dashboard to static assets before compiling the binary.

#### Scenario: Dashboard is built first
- **WHEN** build script starts
- **THEN** system runs the dashboard production build (`apps/dashboard/build.ts`) before binary compilation
- **AND** verifies `apps/dashboard/dist/index.html` exists after the build

#### Scenario: Dashboard build failure stops the pipeline
- **WHEN** the dashboard build fails
- **THEN** binary compilation does not proceed
- **AND** build exits with non-zero code

### Requirement: Cross-platform compilation
The system SHALL compile the unified entrypoint into standalone executables for all supported platforms.

#### Scenario: Build produces binaries for all targets
- **WHEN** build script is executed
- **THEN** system produces standalone executables for:
  - `aop-linux-x64`
  - `aop-linux-arm64`
  - `aop-darwin-x64`
  - `aop-darwin-arm64`

#### Scenario: Each binary is self-contained
- **WHEN** a compiled binary is copied to a machine with no Bun installed
- **THEN** the binary runs without external runtime dependencies
- **AND** bun:sqlite is available within the binary
- **AND** the dashboard UI is accessible at the server's HTTP port

#### Scenario: Dashboard assets are embedded via --asset-dir
- **WHEN** build script compiles the entrypoint
- **THEN** system passes `apps/dashboard/dist/` as an asset directory to `bun build --compile`
- **AND** the dashboard static files are embedded in the resulting binary

#### Scenario: Build uses minification
- **WHEN** build script compiles the entrypoint
- **THEN** system applies `--minify` flag to mangle variable names and compress source
- **AND** the embedded JavaScript is not trivially readable

### Requirement: Version embedding
The system SHALL embed a version string into each compiled binary at build time.

#### Scenario: Version injected from package.json
- **WHEN** build script runs
- **THEN** system reads the version from the root `package.json`
- **AND** injects it as a build-time constant available to the entrypoint

#### Scenario: Git commit hash included
- **WHEN** build script runs in a git repository
- **THEN** system appends the short git commit hash to the version (e.g., `0.1.0+abc1234`)

### Requirement: Checksum generation
The system SHALL produce checksums for each compiled binary for integrity verification.

#### Scenario: SHA-256 checksums generated
- **WHEN** build completes all platform binaries
- **THEN** system generates a `checksums.sha256` file containing SHA-256 hashes for each binary

#### Scenario: Checksum file format
- **WHEN** checksum file is generated
- **THEN** each line follows the format `<sha256-hash>  <filename>` (compatible with `sha256sum --check`)

### Requirement: Build output organization
The system SHALL organize build artifacts in a predictable output directory.

#### Scenario: Output directory structure
- **WHEN** build completes
- **THEN** all artifacts are placed in `dist/release/`:
  - `dist/release/aop-linux-x64`
  - `dist/release/aop-linux-arm64`
  - `dist/release/aop-darwin-x64`
  - `dist/release/aop-darwin-arm64`
  - `dist/release/checksums.sha256`

#### Scenario: Clean build
- **WHEN** build script runs
- **THEN** system removes `dist/release/` before building to ensure no stale artifacts

### Requirement: Build script invocation
The system SHALL be invocable via a simple bun command from the monorepo root.

#### Scenario: Build via package script
- **WHEN** developer runs `bun run build:release`
- **THEN** system executes the cross-compilation build pipeline

#### Scenario: Build for single target
- **WHEN** developer runs `bun run build:release -- --target linux-x64`
- **THEN** system compiles only the specified target (for faster local iteration)

#### Scenario: Build fails on compilation error
- **WHEN** the entrypoint has TypeScript errors
- **THEN** build script exits with non-zero code
- **AND** prints the compilation errors
