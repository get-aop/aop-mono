import type { ZodError } from "zod";

export class ParseError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly zodError: ZodError
  ) {
    const issues = zodError.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        return `  - ${path}${issue.message}`;
      })
      .join("\n");

    super(`Failed to parse ${filePath}:\n${issues}`);
    this.name = "ParseError";
  }
}
