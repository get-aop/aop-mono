import { describe, expect, test } from "bun:test";

interface InputParserModule {
  parseLinearIssueInput(input: string): { refs: string[] };
}

const loadInputParserModule = async (): Promise<InputParserModule> =>
  (await import("./input-parser.ts")) as InputParserModule;

describe("integrations/linear/input-parser", () => {
  test("parses a single Linear ref", async () => {
    const { parseLinearIssueInput } = await loadInputParserModule();

    expect(parseLinearIssueInput("ABC-123")).toEqual({
      refs: ["ABC-123"],
    });
  });

  test("extracts a ref from a Linear issue URL", async () => {
    const { parseLinearIssueInput } = await loadInputParserModule();

    expect(parseLinearIssueInput("https://linear.app/acme/issue/ABC-123/example-task")).toEqual({
      refs: ["ABC-123"],
    });
  });

  test("expands a Linear range", async () => {
    const { parseLinearIssueInput } = await loadInputParserModule();

    expect(parseLinearIssueInput("ABC-123..ABC-126")).toEqual({
      refs: ["ABC-123", "ABC-124", "ABC-125", "ABC-126"],
    });
  });

  test("parses mixed input and collapses duplicates in first-seen order", async () => {
    const { parseLinearIssueInput } = await loadInputParserModule();

    expect(
      parseLinearIssueInput(
        "ABC-123, https://linear.app/acme/issue/ABC-124/example-task, ABC-123..ABC-125, ABC-124",
      ),
    ).toEqual({
      refs: ["ABC-123", "ABC-124", "ABC-125"],
    });
  });

  test("rejects descending ranges", async () => {
    const { parseLinearIssueInput } = await loadInputParserModule();

    expect(() => parseLinearIssueInput("ABC-126..ABC-123")).toThrow(
      "Linear issue range must be ascending",
    );
  });

  test("rejects ranges that cross team prefixes", async () => {
    const { parseLinearIssueInput } = await loadInputParserModule();

    expect(() => parseLinearIssueInput("ABC-123..XYZ-125")).toThrow(
      "Linear issue range must stay within one team prefix",
    );
  });
});
