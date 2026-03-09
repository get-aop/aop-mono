import { describe, expect, test } from "bun:test";
import { getStepBlock, STEP_LIBRARY, STEP_LIBRARY_MAP } from "./step-library.ts";
import { StepType } from "./types.ts";

const VALID_STEP_TYPES = new Set(Object.values(StepType));

const IRON_CLAW_STEP_IDS = [
  "codebase_research",
  "implement_backend",
  "implement_frontend",
  "run_tests",
  "seo_audit",
  "code_review",
  "debug_systematic",
  "address_feedback",
  "market_analysis",
  "add_differentiator",
];

const REQUIRES_INPUT_STEP_IDS = [
  "plan_implementation",
  "visual_verify",
  "design_brief",
  "outline_page",
  "write_copy",
];

describe("Step Library", () => {
  test("contains exactly 15 step blocks", () => {
    expect(STEP_LIBRARY).toHaveLength(15);
  });

  test("all step block IDs are unique", () => {
    const ids = STEP_LIBRARY.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("all step block types are valid StepType values", () => {
    for (const block of STEP_LIBRARY) {
      expect(VALID_STEP_TYPES.has(block.type)).toBe(true);
    }
  });

  test("all step blocks have a promptTemplate ending in .md.hbs", () => {
    for (const block of STEP_LIBRARY) {
      expect(block.promptTemplate).toMatch(/\.md\.hbs$/);
    }
  });

  test("all step blocks have at least one signal", () => {
    for (const block of STEP_LIBRARY) {
      expect(block.signals.length).toBeGreaterThan(0);
    }
  });

  test("all step blocks have positive maxAttempts", () => {
    for (const block of STEP_LIBRARY) {
      expect(block.defaults.maxAttempts).toBeGreaterThan(0);
    }
  });

  describe("Iron Claw rule", () => {
    test("Iron Claw blocks do not include REQUIRES_INPUT", () => {
      for (const id of IRON_CLAW_STEP_IDS) {
        const block = getStepBlock(id);
        expect(block).toBeDefined();
        expect(block?.signals.map((s) => s.name)).not.toContain("REQUIRES_INPUT");
      }
    });
  });

  describe("REQUIRES_INPUT steps", () => {
    test("only plan_implementation, visual_verify, and refine_content include REQUIRES_INPUT", () => {
      const stepsWithRequiresInput = STEP_LIBRARY.filter((b) =>
        b.signals.some((s) => s.name === "REQUIRES_INPUT"),
      ).map((b) => b.id);
      expect(stepsWithRequiresInput.sort()).toEqual([...REQUIRES_INPUT_STEP_IDS].sort());
    });
  });

  describe("STEP_LIBRARY_MAP", () => {
    test("maps all 15 blocks by id", () => {
      expect(STEP_LIBRARY_MAP.size).toBe(15);
      for (const block of STEP_LIBRARY) {
        expect(STEP_LIBRARY_MAP.get(block.id)).toBe(block);
      }
    });
  });

  describe("getStepBlock", () => {
    test("returns block for valid id", () => {
      expect(getStepBlock("codebase_research")).toBeDefined();
      expect(getStepBlock("codebase_research")?.type).toBe("research");
    });

    test("returns undefined for unknown id", () => {
      expect(getStepBlock("nonexistent")).toBeUndefined();
    });
  });
});
