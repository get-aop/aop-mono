FROM oven/bun:1-slim AS base
WORKDIR /app

# Copy workspace root and deps (paths relative to repo root)
COPY package.json bun.lock* bunfig.toml ./
COPY packages/common ./packages/common
COPY packages/infra ./packages/infra
COPY apps/server ./apps/server

# Trim workspaces to only what we copied (server needs common, infra; not scripts, e2e-tests)
RUN bun -e "const pkg = JSON.parse(await Bun.file('package.json').text()); pkg.workspaces = ['apps/*', 'packages/*']; await Bun.write('package.json', JSON.stringify(pkg));"

RUN bun install --ignore-scripts

EXPOSE 3000

# Many platforms (Render, Fly.io, Railway) set PORT; fallback to 3000
ENV AOP_SERVER_PORT=3000

# Use PORT if set (e.g. Render, Fly.io), otherwise AOP_SERVER_PORT
CMD ["sh", "-c", "export AOP_SERVER_PORT=${PORT:-$AOP_SERVER_PORT}; exec bun run apps/server/src/main.ts"]
