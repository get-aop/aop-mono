import { describe, expect, test } from "bun:test";
import { parseNotes } from "../src/notes.ts";

describe("parseNotes", () => {
  test("parses note lines into status, title, and tags", () => {
    const notes = parseNotes(
      ["todo|Write benchmark plan|bench,planning", "done|Ship changelog|release"].join("\n"),
    );

    expect(notes).toEqual([
      {
        status: "todo",
        title: "Write benchmark plan",
        tags: ["bench", "planning"],
      },
      {
        status: "done",
        title: "Ship changelog",
        tags: ["release"],
      },
    ]);
  });
});
