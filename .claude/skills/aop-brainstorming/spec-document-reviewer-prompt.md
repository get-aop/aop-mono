# AOP Spec Document Reviewer Prompt Template

Use this template when dispatching a spec document reviewer subagent for AOP task-local design docs.

**Purpose:** Verify the design is complete, consistent, and ready for task scaffolding and implementation planning.

**Dispatch after:** Design document is written to `docs/tasks/<task-slug>/design.md`

```
Task tool (general-purpose):
  description: "Review AOP design document"
  prompt: |
    You are a spec document reviewer. Verify this design is complete and ready for task creation.

    **Design to review:** [SPEC_FILE_PATH]

    ## What to Check

    | Category | What to Look For |
    |----------|------------------|
    | Completeness | TODOs, placeholders, "TBD", incomplete sections |
    | Coverage | Missing error handling, edge cases, integration points |
    | Consistency | Internal contradictions, conflicting requirements |
    | Clarity | Ambiguous requirements |
    | YAGNI | Unrequested features, over-engineering |
    | Scope | Focused enough for a single task package |
    | Architecture | Units with clear boundaries, well-defined interfaces, independently understandable and testable |

    ## CRITICAL

    Look especially hard for:
    - Any TODO markers or placeholder text
    - Sections saying "to be defined later" or "will spec when X is done"
    - Sections noticeably less detailed than others
    - Units that lack clear boundaries or interfaces

    ## Output Format

    ## Spec Review

    **Status:** ✅ Approved | ❌ Issues Found

    **Issues (if any):**
    - [Section X]: [specific issue] - [why it matters]

    **Recommendations (advisory):**
    - [suggestions that don't block approval]
```

**Reviewer returns:** Status, Issues (if any), Recommendations
