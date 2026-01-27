import { describe, expect, test } from "bun:test";

describe("task-planner skill", () => {
  const skillPath = `${import.meta.dir}/SKILL.md`;

  test("includes step for prompting user to move task to PENDING", async () => {
    const content = await Bun.file(skillPath).text();

    expect(content).toContain("PENDING");
    expect(content).toContain("AskUserQuestion");
  });

  test("only prompts when task is in BACKLOG status", async () => {
    const content = await Bun.file(skillPath).text();

    expect(content).toContain("BACKLOG");
  });

  test("includes option for user to decline moving to PENDING", async () => {
    const content = await Bun.file(skillPath).text();

    expect(content).toMatch(/review.*first|manually.*later/i);
  });

  test("summarizes what was created before prompting", async () => {
    const content = await Bun.file(skillPath).text();

    expect(content).toMatch(/summar/i);
    expect(content).toMatch(/subtask/i);
  });
});
