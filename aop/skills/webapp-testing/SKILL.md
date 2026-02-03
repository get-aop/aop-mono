---
name: webapp-testing
description: Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.
license: Complete terms in LICENSE.txt
---

# Web Application Testing

To test local web applications, write native typescript Playwright scripts.

**Helper Scripts Available**:
- `scripts/with-server.ts` - Manages server lifecycle (supports multiple servers)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is absolutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as black-box scripts rather than ingested into your context window.

## Decision Tree: Choosing Your Approach

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Use scripts/with-server.ts to manage server lifecycle:
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for networkidle
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

## Server Lifecycle Management

When testing applications that need a dev server, use the `with-server.ts` script.

### Usage

```bash
bun scripts/with-server.ts --server "<command>" --port <port> [--timeout <ms>] -- bun your-playwright-script.ts
```
### Examples

**Single server:**
```bash
bun scripts/with-server.ts --server "npm run dev" --port 5173 -- bun test.ts
```

**Multiple servers (API + Web):**
```bash
bun scripts/with-server.ts \
  --server "npm run api" --port 3000 \
  --server "npm run web" --port 5173 \
  -- bun your-playwright-script.ts
```

To create an automation script, include only Playwright logic (servers are managed automatically):
```ts

```

### Behavior

1. Starts each server in sequence
2. Waits for each port to accept connections (polls every 500ms)
3. Runs the test command after all servers are ready
4. Terminates all servers when the command exits
5. Propagates the exit code from the test command

## Best Practices

1. **Prefer snapshot over screenshot** for understanding page structure. Snapshots provide element refs needed for interaction.

2. **Wait for content** - After navigation or actions, use `browser_snapshot` to verify the page has loaded before proceeding.

3. **Use element refs from snapshots** - The snapshot provides refs like `[ref=s1e5]` that you use for clicking/typing.

4. **Check console messages** - After tests, check `browser_console_messages` for JavaScript errors.

5. **Clean up** - Close the browser with `browser_close` when done testing.

## Reconnaissance-Then-Action Pattern

1. **Inspect rendered DOM**:
   ```ts // TODO: convert to typescript
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```

2. **Identify selectors** from inspection results

3. **Execute actions** using discovered selectors

## Common Pitfall

 // TODO: convert to typescript
❌ **Don't** inspect the DOM before waiting for `networkidle` on dynamic apps
✅ **Do** wait for `page.wait_for_load_state('networkidle')` before inspection

## Best Practices

 // TODO: convert to typescript
- **Use bundled scripts as black boxes** - To accomplish a task, consider whether one of the scripts available in `scripts/` can help. These scripts handle common, complex workflows reliably without cluttering the context window. Use `--help` to see usage, then invoke directly. 
- Use `sync_playwright()` for synchronous scripts
- Always close the browser when done
- Use descriptive selectors: `text=`, `role=`, CSS selectors, or IDs
- Add appropriate waits: `page.wait_for_selector()` or `page.wait_for_timeout()`

## Reference Files

- **examples/** - Examples showing common patterns:
  - `element_discovery.ts` - Discovering buttons, links, and inputs on a page
  - `static_html_automation.ts` - Using file:// URLs for local HTML
  - `console_logging.ts` - Capturing console logs during automation