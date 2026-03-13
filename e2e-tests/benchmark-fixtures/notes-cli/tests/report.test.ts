import { describe, expect, test } from "bun:test";
import { renderPlainReport } from "../src/report.ts";

describe("renderPlainReport", () => {
  test("renders note titles as a bullet list", () => {
    const output = renderPlainReport([
      {
        status: "todo",
        title: "Write benchmark plan",
        tags: ["bench"],
      },
      {
        status: "done",
        title: "Ship changelog",
        tags: ["release"],
      },
    ]);

    expect(output).toBe(["- Write benchmark plan", "- Ship changelog"].join("\n"));
  });
});
