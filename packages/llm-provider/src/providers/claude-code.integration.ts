import { beforeAll, expect, test } from "bun:test";
import { configureLogging, getLogger } from "@aop/infra";
import { ClaudeCodeProvider } from "./claude-code";

const isCI = Boolean(process.env.CI);
const log = getLogger("aop", "llm-provider", "test");

beforeAll(async () => {
  await configureLogging({ level: "debug" });
});

if (!isCI) {
  test("ClaudeCodeProvider integration > runs a basic prompt and returns result with session ID", async () => {
    const provider = new ClaudeCodeProvider();
    const outputs: Record<string, unknown>[] = [];

    const result = await provider.run({
      prompt: "Reply with exactly: HELLO_TEST_123",
      onOutput: (data) => outputs.push(data),
    });

    const assistantMessages = outputs.filter((o) => o.type === "assistant");
    for (const msg of assistantMessages.slice(-5)) {
      const message = msg.message as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = message.content
        ?.filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
      if (text) {
        log.info("Agent: {text}", { text });
      }
    }

    expect(result.exitCode).toBe(0);
    expect(result.sessionId).toBeDefined();
    expect(typeof result.sessionId).toBe("string");
    expect(outputs.length).toBeGreaterThan(0);

    const allText = assistantMessages
      .map((msg) => {
        const message = msg.message as {
          content?: Array<{ type: string; text?: string }>;
        };
        return message.content
          ?.filter((c) => c.type === "text" && c.text)
          .map((c) => c.text)
          .join("");
      })
      .join("");
    expect(allText).toContain("HELLO_TEST_123");
  }, 30_000);
}
