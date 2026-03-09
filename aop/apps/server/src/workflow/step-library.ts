import type { SignalDefinition } from "@aop/common/protocol";
import type { StepType } from "./types.ts";

export interface StepBlockDefinition {
  id: string;
  type: StepType;
  category: "general" | "backend" | "frontend" | "business" | "research";
  description: string;
  signals: SignalDefinition[];
  promptTemplate: string;
  defaults: { maxAttempts: number };
}

export const STEP_LIBRARY: StepBlockDefinition[] = [
  {
    id: "codebase_research",
    type: "research",
    category: "general",
    description: "Explore codebase using Grep/Glob/Read to identify patterns and conventions",
    signals: [
      {
        name: "RESEARCH_COMPLETE",
        description: "codebase exploration is done, findings are written",
      },
    ],
    promptTemplate: "codebase-research.md.hbs",
    defaults: { maxAttempts: 3 },
  },
  {
    id: "plan_implementation",
    type: "iterate",
    category: "general",
    description: "Read context files, create plan.md and numbered subtask docs, get approval before building",
    signals: [
      {
        name: "PLAN_READY",
        description: "plan.md and numbered subtask docs are written and ready for human approval",
      },
      {
        name: "REQUIRES_INPUT",
        description:
          "need clarification before planning can proceed. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
      },
    ],
    promptTemplate: "plan-implementation.md.hbs",
    defaults: { maxAttempts: 3 },
  },
  {
    id: "implement_backend",
    type: "implement",
    category: "backend",
    description: "Work through numbered subtask docs using TDD, implement backend code",
    signals: [
      { name: "TASK_COMPLETE", description: "all numbered subtask docs are complete" },
      { name: "CHUNK_DONE", description: "completed a chunk, more numbered subtask docs remain" },
    ],
    promptTemplate: "implement-backend.md.hbs",
    defaults: { maxAttempts: 15 },
  },
  {
    id: "implement_frontend",
    type: "implement",
    category: "frontend",
    description: "Work through numbered subtask docs, implement frontend code with visual testing",
    signals: [
      { name: "TASK_COMPLETE", description: "all numbered subtask docs are complete" },
      { name: "CHUNK_DONE", description: "completed a chunk, more numbered subtask docs remain" },
    ],
    promptTemplate: "implement-frontend.md.hbs",
    defaults: { maxAttempts: 15 },
  },
  {
    id: "visual_verify",
    type: "review",
    category: "frontend",
    description: "Take screenshots, present visual state for human verification",
    signals: [
      { name: "LOOKS_GOOD", description: "visual implementation matches expectations" },
      { name: "NEEDS_CHANGES", description: "identified visual issues that need fixing" },
      {
        name: "REQUIRES_INPUT",
        description:
          "need human judgment on the visual result. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
      },
    ],
    promptTemplate: "visual-verify.md.hbs",
    defaults: { maxAttempts: 5 },
  },
  {
    id: "run_tests",
    type: "test",
    category: "general",
    description: "Run project tests and report results",
    signals: [
      { name: "TESTS_PASS", description: "all relevant tests pass" },
      { name: "TESTS_FAIL", description: "one or more tests are failing, details reported" },
    ],
    promptTemplate: "run-tests.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "seo_audit",
    type: "review",
    category: "frontend",
    description: "Run lighthouse/SEO checks and report results",
    signals: [
      { name: "SEO_PASS", description: "SEO checks meet acceptable thresholds" },
      { name: "SEO_NEEDS_WORK", description: "issues found that need addressing" },
    ],
    promptTemplate: "seo-audit.md.hbs",
    defaults: { maxAttempts: 1 },
  },
  {
    id: "code_review",
    type: "review",
    category: "general",
    description: "Review code changes for quality, remove AI slop",
    signals: [
      { name: "REVIEW_PASSED", description: "code is clean and ready" },
      { name: "REVIEW_FAILED", description: "found issues that need the implementer to address" },
    ],
    promptTemplate: "code-review-step.md.hbs",
    defaults: { maxAttempts: 2 },
  },
  {
    id: "debug_systematic",
    type: "debug",
    category: "general",
    description: "Systematically debug issues using structured methodology",
    signals: [{ name: "FIX_COMPLETE", description: "issue is fixed and verified" }],
    promptTemplate: "debug-systematic.md.hbs",
    defaults: { maxAttempts: 10 },
  },
  {
    id: "address_feedback",
    type: "implement",
    category: "general",
    description: "Read PR comments, address each piece of feedback",
    signals: [
      { name: "FEEDBACK_ADDRESSED", description: "all feedback has been addressed" },
      { name: "CHUNK_DONE", description: "addressed a chunk of feedback, more remains" },
    ],
    promptTemplate: "address-feedback.md.hbs",
    defaults: { maxAttempts: 10 },
  },
  {
    id: "market_analysis",
    type: "research",
    category: "frontend",
    description:
      "Research competitors, audience, positioning, and conversion patterns for landing page design",
    signals: [
      { name: "RESEARCH_COMPLETE", description: "market research is done, findings are written" },
    ],
    promptTemplate: "market-analysis.md.hbs",
    defaults: { maxAttempts: 3 },
  },
  {
    id: "design_brief",
    type: "iterate",
    category: "frontend",
    description:
      "Ingest moodboard, brand assets, and style references to produce design tokens and visual direction",
    signals: [
      { name: "BRIEF_READY", description: "design brief with tokens is written and ready" },
      {
        name: "REQUIRES_INPUT",
        description:
          "need visual references or brand direction. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
      },
    ],
    promptTemplate: "design-brief.md.hbs",
    defaults: { maxAttempts: 3 },
  },
  {
    id: "outline_page",
    type: "iterate",
    category: "frontend",
    description:
      "Create section-by-section landing page outline with CTA strategy and conversion flow",
    signals: [
      {
        name: "PLAN_READY",
        description: "outline is written to plan.md, ready for human approval",
      },
      { name: "PLAN_APPROVED", description: "human approved the outline, proceed to copy" },
      {
        name: "REQUIRES_INPUT",
        description:
          "need clarification on page structure or goals. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
      },
    ],
    promptTemplate: "outline-landing-page.md.hbs",
    defaults: { maxAttempts: 3 },
  },
  {
    id: "write_copy",
    type: "iterate",
    category: "frontend",
    description: "Write CRO-optimized copy for all landing page sections",
    signals: [
      { name: "CONTENT_READY", description: "copy is written and CRO-reviewed" },
      {
        name: "REQUIRES_INPUT",
        description:
          "need clarification on messaging or tone. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
      },
    ],
    promptTemplate: "landing-page-copy.md.hbs",
    defaults: { maxAttempts: 5 },
  },
  {
    id: "add_differentiator",
    type: "implement",
    category: "frontend",
    description: "Design and build a unique interactive widget that differentiates the product",
    signals: [
      { name: "TASK_COMPLETE", description: "differentiator widget is built and integrated" },
      { name: "CHUNK_DONE", description: "completed a chunk, more work remains" },
    ],
    promptTemplate: "add-differentiator.md.hbs",
    defaults: { maxAttempts: 10 },
  },
];

export const STEP_LIBRARY_MAP = new Map(STEP_LIBRARY.map((block) => [block.id, block]));

export const getStepBlock = (id: string): StepBlockDefinition | undefined =>
  STEP_LIBRARY_MAP.get(id);
