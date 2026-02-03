## Why

AOP needs a consistent logging solution that works across all runtime contexts—CLI daemons, backend servers, and frontend applications. Without this, each app would implement its own logging, leading to inconsistent output formats, difficulty correlating logs, and duplicated configuration code.

## What Changes

- Create a new `@aop/infra` package as the foundation for shared infrastructure utilities
- Implement a logger module backed by [logtape](https://logtape.org/)—a zero-dependency library that runs everywhere (Bun, Node, browsers, edge)
- Provide a simple API: `getLogger(category)` for obtaining loggers, `configureLogging()` for app-level setup

## Capabilities

### New Capabilities
- `infra-logger`: Unified logging across all AOP runtimes with hierarchical categories

## Impact

- `packages/infra/` - New package
- `packages/infra/src/logger.ts` - Logger implementation
- `packages/infra/src/index.ts` - Package exports
- `packages/infra/package.json` - Package configuration
