FROM oven/bun:1.3-alpine

# Install git for worktree operations and docker-cli for sibling containers
RUN apk add --no-cache git docker-cli

# Allow git to work with directories owned by different users (needed for mounted volumes)
RUN git config --global --add safe.directory '*'

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source files
COPY src/ ./src/
COPY packages/ ./packages/

# Global directory for projects, tasks, worktrees
VOLUME /root/.claude-agi

ENV DASHBOARD_PORT=3001
ENV MAX_CONCURRENT_AGENTS=2

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/state || exit 1

CMD ["bun", "run", "src/core/container-entrypoint.ts"]
