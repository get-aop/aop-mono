#!/bin/bash
set -e

echo "Building dependencies..."
bun run build:deps

echo "Running electron-forge package..."
bunx electron-forge package &
FORGE_PID=$!

sleep 20
if [ -f .webpack/arm64/main.js ]; then
  echo "Copying main.js to expected location..."
  cp .webpack/arm64/main.js .webpack/main
fi

wait $FORGE_PID || true

echo "Build process complete"
