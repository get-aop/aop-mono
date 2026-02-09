#!/bin/bash
# Workaround script for electron-forge webpack output issue
# The webpack plugin outputs to .webpack/arm64/ but expects .webpack/main

set -e

echo "Building dependencies..."
bun run build:deps

echo "Running electron-forge package..."
# Run webpack build only first
bunx electron-forge package &
FORGE_PID=$!

# Wait for webpack to build and then copy the file
sleep 20
if [ -f .webpack/arm64/main.js ]; then
  echo "Copying main.js to expected location..."
  cp .webpack/arm64/main.js .webpack/main
fi

# Wait for the build to complete
wait $FORGE_PID || true

echo "Build process complete"
