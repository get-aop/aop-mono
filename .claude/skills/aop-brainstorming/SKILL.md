---
name: aop:brainstorming
description: "Gather requirements through focused conversation before implementation. Use before any creative work - creating features, building components, adding functionality."
---

# Brainstorming - Requirements Gathering

Help turn ideas into fully formed designs and specs through short context discovery, focused questions, and a lightweight design outline.

**Input**: A task description (e.g., "Build a user authentication feature") OR no input to start open-ended.

**Process**

1. **Quick project context scan (timeboxed)**
   - Start by understanding the current project state (files, docs, recent commits).
   - Use at most 2-3 lightweight tool calls (e.g., README, docs/ARCHITECTURE.md, `git log -5 --oneline`).
   - Do NOT use the Task tool for exploration.
   - If context is still unclear, ask the user instead of exploring deeper.

2. **Ask clarifying questions (max 5 total, then STOP asking)**
   - Ask questions ONE AT A TIME using **AskUserQuestion tool**.
   - Multiple choice preferred; open-ended is fine if needed.
   - Lead with your recommendation and label it "(Recommended)".
   - Use a short **header** to name the topic and avoid duplicates.
   - Focus on understanding: purpose, constraints, success criteria, scope, integration points, risks.

3. **Explore approaches**
   - Propose 2-3 approaches with trade-offs.
   - Lead with your recommended approach and reasoning.
   - If a decision is needed, ask a single AskUserQuestion to confirm.

4. **Present the design in sections**
   - Once you understand what you're building, present the design.
   - Break it into sections of 200-300 words.
   - Cover: architecture, components, data flow, error handling, testing.
   - After each section, ask "Does this look right so far?" **if you still have question budget**.
   - If you are out of question budget, include a short prompt for corrections and continue.

5. **Summarize and output completion marker**
   - Provide a concise summary covering:
     - What we're building (title + description)
     - Key requirements
     - Acceptance criteria

   Output this marker with structured JSON:

   ```
   [BRAINSTORM_COMPLETE]
   {
     "title": "Short descriptive title (max 60 chars)",
     "description": "2-3 sentence description of what we're building and why",
     "requirements": ["Specific requirement 1", "Specific requirement 2", ...],
     "acceptanceCriteria": ["Testable criterion 1", "Testable criterion 2", ...]
   }
   ```

   **CRITICAL: Output ONLY the marker and raw JSON.**
   - Do NOT wrap in code fences
   - Do NOT add any text before or after the JSON
   - Do NOT repeat the marker
   - After outputting the marker, STOP IMMEDIATELY
   - Do NOT ask about next steps
   - Do NOT run any commands
   - Do NOT read files
   - The CLI will handle what happens next (opsx:new, opsx:ff, etc.)

**After the Design (only if explicitly requested and not in create-task flow)**

- If the prompt includes "Task to brainstorm:", treat it as create-task flow and skip file writes/commits.
- Write the validated design to `docs/plans/YYYY-MM-DD-<topic>-design.md`.
- Do NOT run git commit unless the user explicitly asks.
- Ask: "Ready to set up for implementation?"

**Guardrails**

- **ALWAYS use AskUserQuestion tool** - Never ask questions as plain text
- **ONE question per turn** - Multiple questions will be REJECTED
- **Max 5 questions** - Stay focused and efficient
- **Timebox context scans** - Max 3 tool calls, then ask the user
- **No Task tool** - Do not use agents or multi-step explorers
- **YAGNI** - Remove unnecessary features ruthlessly
- Do NOT skip the completion marker - it's required for CLI integration
- **STOP after [BRAINSTORM_COMPLETE]** - Output the marker with JSON and STOP
