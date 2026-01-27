# Template Prompts SOTA Optimization

Date: 2026-01-27

## Research Summary

Researched Claude 4/Opus 4.5 prompting best practices from:
- Anthropic Platform Documentation
- Anthropic Cookbook
- Anthropic Courses

## Key Findings for Claude 4/Opus 4.5

1. **Be Explicit About Actions** (Critical for Claude 4)
   - Use "Make these changes" not "Can you suggest changes"
   - Claude 4 requires more explicit direction than previous versions

2. **XML Tags for Structure**
   - Use tags like `<context>`, `<instructions>`, `<examples>` for better parsing
   - Helps Claude parse complex prompts more accurately

3. **Chain of Thought**
   - Use `<thinking>` or `<analysis>` tags for multi-step reasoning

4. **Default to Action**
   - Add explicit instruction: "Implement changes rather than only suggesting them"

5. **Examples (Multishot)**
   - 1-2 concrete examples significantly improve reliability

6. **Long Context Tips**
   - Place critical info at start AND end of prompt (primacy/recency effect)

## Template Structure Adopted

```markdown
# [Agent Role]

<role>
You are a [role] agent. [1-2 sentence expertise statement]
</role>

<context>
Read these files before proceeding:
- [explicit paths]
</context>

<objective>
[Clear goal statement]
</objective>

<success_criteria>
- [ ] [Checkable item 1]
- [ ] [Checkable item 2]
</success_criteria>

<instructions>
[Numbered steps - imperative voice]
</instructions>

<decision_boundaries>
**Proceed when:** [conditions]
**Stop and report BLOCKED when:** [conditions]
</decision_boundaries>

<important>
[Critical reminders, action directives]
</important>
```

## Templates Updated

1. **implementation.md** - TDD workflow with explicit step transitions
2. **review.md** - Subtask code review with decision boundaries
3. **completing-task.md** - Task verification against acceptance criteria
4. **completion-review.md** - Final review before PR creation
5. **conflict-solver.md** - Merge conflict resolution with clear abort conditions
6. **planning.md** - Interactive subtask generation

## Key Improvements

- Added XML tags for better prompt parsing
- Added `<important>` section for Claude 4's explicit action requirement
- More imperative voice throughout
- Clear decision boundaries (when to proceed vs stop)
- Checkable success criteria
- Removed ambiguous "soft" language
