# devsfactory

Automating your development pipeline with AI agents.

## Prerequisites

- [Bun](https://bun.sh/) v1.0 or later
- [Git](https://git-scm.com/)
- [Claude CLI](https://github.com/anthropics/claude-code) (for agent execution)

## Installation

### From source

```bash
# Clone the repository
git clone https://github.com/get-aop/aop.git
cd devsfactory

# Install dependencies
bun install

# Link globally (makes 'aop' command available)
bun link
```

### Development

```bash
# Clone and install
git clone https://github.com/get-aop/aop.git
cd devsfactory
bun install

# Run directly
bun run start

# Or use the bin name
bun run aop
```

## Usage

```bash
# Show help
aop --help

# Show version
aop --version

# Start the orchestrator (from a git repository with .devsfactory directory)
aop
```

## Configuration

Configuration is read from environment variables. Create a `.env` file in your project root:

```bash
# Copy the example configuration
cp .env.example .env
```

### Environment Variables

| Variable                | Description                     | Default        |
| ----------------------- | ------------------------------- | -------------- |
| `DEVSFACTORY_DIR`       | Task definitions directory      | `.devsfactory` |
| `WORKTREES_DIR`         | Git worktrees directory         | `.worktrees`   |
| `MAX_CONCURRENT_AGENTS` | Maximum parallel agents         | `2`            |
| `DEBOUNCE_MS`           | File watcher debounce (ms)      | `100`          |
| `RETRY_INITIAL_MS`      | Initial retry backoff (ms)      | `2000`         |
| `RETRY_MAX_MS`          | Maximum retry backoff (ms)      | `300000`       |
| `DEBUG`                 | Enable debug logging            | `false`        |
| `LOG_MODE`              | Log format (`pretty` or `json`) | `pretty`       |

## Project Setup

To use devsfactory in your project:

1. Initialize a git repository (if not already):

   ```bash
   git init
   ```

2. Create the devsfactory directory:

   ```bash
   mkdir .devsfactory
   ```

3. Add task definitions as markdown files in `.devsfactory/`

4. Run the orchestrator:
   ```bash
   aop
   ```

## Development

### Running Tests

```bash
# Run all unit tests
bun test src/

# Run e2e tests (requires Claude CLI)
bun run test:e2e

# Run specific e2e test
bun run test:e2e:orchestrator
```

### Type Checking

```bash
bun run typecheck
```

### Linting

```bash
# Check for issues
bun run lint

# Auto-fix issues
bun run lint:fix
```

### Building

```bash
bun run build
```

## Architecture

See [DESIGN.md](./DESIGN.md) for detailed architecture documentation.

## License

MIT
