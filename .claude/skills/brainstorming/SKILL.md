---
name: brainstorming
description: "You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation."
---

# Brainstorming Ideas Into Designs

## ⚠️ CRITICAL: Tool Requirements

### ALWAYS Use AskUserQuestion Tool - NEVER Plain Text

**EVERY question you ask MUST use the `AskUserQuestion` tool.** This is a HARD requirement. Plain text questions WILL NOT BE SEEN by the user in non-interactive sessions.

```
❌ WRONG: "Does this look right?"              // Plain text = USER NEVER SEES IT
❌ WRONG: "What do you think about...?"        // Plain text = SESSION ENDS
✅ RIGHT: AskUserQuestion({questions: [...]})  // Tool call = User can respond
```

This includes:
- Initial clarifying questions
- Design validation questions ("Does this section look right?")
- Follow-up questions
- ANY question that requires user input

**If you ask a question as plain text, the session will end immediately and the user will not be able to respond.**

### One Question Per Turn
**You MUST ask exactly ONE question per AskUserQuestion call.** This is a hard requirement for non-interactive session management.

```
❌ WRONG: questions: [{q1}, {q2}, {q3}, {q4}]  // Multiple questions = REJECTED
✅ RIGHT: questions: [{q1}]                    // Single question = ACCEPTED
```

If you send multiple questions, your request will be rejected and you'll have to retry, wasting time and tokens. Ask your most important question first, then ask follow-ups based on the answer.

### Maximum 5 Questions Total
**You MUST NOT ask more than 5 questions total.** After 5 questions, proceed with the design based on the information you have. If critical information is missing after 5 questions, make reasonable assumptions and document them in the design.

This limit ensures brainstorming sessions remain focused and efficient.

---

## Overview

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design in small sections (200-300 words), checking after each section whether it looks right so far.

## The Process

**Understanding the idea:**

- Check out the current project state first (files, docs, recent commits)
- Ask questions ONE AT A TIME to refine the idea
- **ALWAYS use the `AskUserQuestion` tool** for ALL questions - this enables proper session management for non-interactive workflows
- **EXACTLY ONE question per AskUserQuestion call** - the `questions` array MUST have length 1. Never batch multiple questions. Ask one, wait for answer, think, then ask the next based on the answer.
- Prefer multiple choice questions when possible, but open-ended is fine too
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

**Presenting the design:**

- Once you believe you understand what you're building, present the design
- Break it into sections of 200-300 words
- **After each section, use AskUserQuestion tool to ask if it looks right** - DO NOT ask as plain text
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

Example design validation (MUST use tool, not plain text):
```
<section text here>

Then call AskUserQuestion with:
{
  "questions": [{
    "question": "Does this architecture overview look right so far?",
    "header": "Design Review",
    "options": [
      {"label": "Looks good", "description": "Proceed to the next section"},
      {"label": "Needs changes", "description": "I have feedback on this section"}
    ],
    "multiSelect": false
  }]
}
```

## After the Design

- Write the validated design to `.leo/brainstorm/YYYY-MM-DD-<topic>.md`

## Key Principles

- **⚠️ EXACTLY ONE question per AskUserQuestion call** - The `questions` array MUST have exactly 1 element. Multiple questions will be REJECTED and waste time. Ask, wait for answer, process, then ask the next question.
- **ALWAYS use AskUserQuestion tool** - Never ask questions as plain text; always use the AskUserQuestion tool
- **Multiple choice preferred** - Easier to answer than open-ended when possible
- **YAGNI ruthlessly** - Remove unnecessary features from all designs
- **Explore alternatives** - Always propose 2-3 approaches before settling
- **Incremental validation** - Present design in sections, validate each
- **Be flexible** - Go back and clarify when something doesn't make sense
