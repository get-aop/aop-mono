# Visual Companion Guide

Browser-based visual brainstorming companion for showing mockups, diagrams, and options.

## When to Use

Decide per-question, not per-session. The test: **would the user understand this better by seeing it than reading it?**

**Use the browser** when the content itself is visual:

- **UI mockups** - wireframes, layouts, navigation structures, component designs
- **Architecture diagrams** - system components, data flow, relationship maps
- **Side-by-side visual comparisons** - comparing two layouts, two color schemes, two design directions
- **Design polish** - when the question is about look and feel, spacing, visual hierarchy
- **Spatial relationships** - state machines, flowcharts, entity relationships rendered as diagrams

**Use the terminal** when the content is text or tabular:

- **Requirements and scope questions** - "what does X mean?", "which features are in scope?"
- **Conceptual A/B/C choices** - picking between approaches described in words
- **Tradeoff lists** - pros/cons, comparison tables
- **Technical decisions** - API design, data modeling, architectural approach selection
- **Clarifying questions** - anything where the answer is words, not a visual preference

A question *about* a UI topic is not automatically a visual question. "What kind of wizard do you want?" is conceptual - use the terminal. "Which of these wizard layouts feels right?" is visual - use the browser.

## How It Works

The server watches a directory for HTML files and serves the newest one to the browser. You write HTML content, the user sees it in their browser and can click to select options. Selections are recorded to a `.events` file that you read on your next turn.

**Content fragments vs full documents:** If your HTML file starts with `<!DOCTYPE` or `<html`, the server serves it as-is (just injects the helper script). Otherwise, the server automatically wraps your content in the frame template - adding the header, CSS theme, selection indicator, and all interactive infrastructure. **Write content fragments by default.** Only write full documents when you need complete control over the page.

## Starting a Session

```bash
# Start server with persistence (mockups saved to project)
${CLAUDE_PLUGIN_ROOT}/lib/brainstorm-server/start-server.sh --project-dir /path/to/project

# Returns: {"type":"server-started","port":52341,"url":"http://localhost:52341",
#           "screen_dir":"/path/to/project/.superpowers/brainstorm/12345-1706000000"}
```

Save `screen_dir` from the response. Tell user to open the URL.

**Note:** Pass the project root as `--project-dir` so mockups persist in `.superpowers/brainstorm/` and survive server restarts. Without it, files go to `/tmp` and get cleaned up. Remind the user to add `.superpowers/` to `.gitignore` if it's not already there.

**Codex behavior:** In Codex (`CODEX_CI=1`), `start-server.sh` auto-switches to foreground mode by default because background jobs may be reaped. Use `--background` only if your environment reliably preserves detached processes.

**If background processes are reaped in your environment:** run in foreground from a persistent terminal session:

```bash
${CLAUDE_PLUGIN_ROOT}/lib/brainstorm-server/start-server.sh --project-dir /path/to/project --foreground
```

In `--foreground` mode, the command stays attached and serves until interrupted.

If the URL is unreachable from your browser (common in remote/containerized setups), bind a non-loopback host:

```bash
${CLAUDE_PLUGIN_ROOT}/lib/brainstorm-server/start-server.sh \
  --project-dir /path/to/project \
  --host 0.0.0.0 \
  --url-host localhost
```

Use `--url-host` to control what hostname is printed in the returned URL JSON.

## The Loop

1. **Write HTML** to a new file in `screen_dir`:
   - Use semantic filenames: `platform.html`, `visual-style.html`, `layout.html`
   - **Never reuse filenames** - each screen gets a fresh file
   - Use Write tool - **never use cat/heredoc** (dumps noise into terminal)
   - Server automatically serves the newest file

2. **Tell user what to expect and end your turn:**
   - Remind them of the URL (every step, not just first)
   - Give a brief text summary of what's on screen (e.g., "Showing 3 layout options for the homepage")
   - Ask them to respond in the terminal: "Take a look and let me know what you think. Click to select an option if you'd like."

3. **On your next turn** - after the user responds in the terminal:
   - Read `$SCREEN_DIR/.events` if it exists - this contains the user's browser interactions (clicks, selections) as JSON lines
   - Merge with the user's terminal text to get the full picture
   - The terminal message is the primary feedback; `.events` provides structured interaction data

4. **Iterate or advance** - if feedback changes current screen, write a new file (e.g., `layout-v2.html`). Only move to the next question when the current step is validated.

5. **Unload when returning to terminal** - when the next step doesn't need the browser (e.g., a clarifying question, a tradeoff discussion), push a waiting screen to clear the stale content:

   ```html
   <div style="display:flex;align-items:center;justify-content:center;min-height:60vh">
     <p class="subtitle">Continuing in terminal...</p>
   </div>
   ```

   This prevents the user from staring at a resolved choice while the conversation has moved on. When the next visual question comes up, push a new content file as usual.

6. Repeat until done.
