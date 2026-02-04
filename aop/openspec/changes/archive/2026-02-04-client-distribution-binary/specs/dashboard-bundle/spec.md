## ADDED Requirements

### Requirement: Dashboard assets are embedded in the compiled binary
The build pipeline SHALL pre-build the dashboard and embed the static output in the compiled binary so end users get the dashboard UI without additional configuration.

#### Scenario: Dashboard is pre-built before binary compilation
- **WHEN** build script runs
- **THEN** system first runs the dashboard build (`apps/dashboard/build.ts`)
- **AND** produces static files in `apps/dashboard/dist/` (index.html, JS bundles, CSS)
- **AND** the dashboard build completes before binary compilation begins

#### Scenario: Dashboard static files are embedded via --asset-dir
- **WHEN** binary compilation runs
- **THEN** system uses Bun's `--asset-dir` flag to embed `apps/dashboard/dist/` contents into the binary
- **AND** the files are accessible at runtime via standard file path resolution relative to the executable

#### Scenario: Binary serves dashboard without DASHBOARD_STATIC_PATH
- **WHEN** the compiled binary starts the local-server via `aop run`
- **THEN** the server automatically serves the embedded dashboard at `http://localhost:3847/`
- **AND** the user does NOT need to set `DASHBOARD_STATIC_PATH`
- **AND** the SPA routing (fallback to index.html) works for all client-side routes

### Requirement: Embedded dashboard path resolution
The unified entrypoint SHALL resolve the embedded dashboard asset path and pass it to `startServer`.

#### Scenario: Entrypoint provides dashboard path to server
- **WHEN** `aop run` starts
- **THEN** the entrypoint resolves the embedded dashboard directory path
- **AND** passes it as `dashboardStaticPath` to `startServer()`

#### Scenario: Development mode still uses env var
- **WHEN** running from source (not compiled binary)
- **AND** `DASHBOARD_STATIC_PATH` env var is set
- **THEN** the server uses the env var value instead of embedded assets
- **AND** development workflow is unchanged

### Requirement: Dashboard build failure blocks binary build
The build pipeline SHALL fail the entire build if the dashboard fails to build.

#### Scenario: Dashboard build error stops pipeline
- **WHEN** the dashboard build fails (TypeScript errors, Tailwind errors)
- **THEN** the binary compilation does not proceed
- **AND** build script exits with non-zero code
- **AND** error output from the dashboard build is shown

### Requirement: Dashboard assets are minified
The embedded dashboard SHALL use production-optimized assets.

#### Scenario: Production build optimizations applied
- **WHEN** dashboard is built for embedding
- **THEN** JavaScript bundles are minified with code splitting
- **AND** CSS is minified
- **AND** source maps are excluded from the binary (not embedded)
