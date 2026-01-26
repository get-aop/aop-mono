import { parse, stringify } from "yaml";
import { ZodError, type z } from "zod";

export interface ParsedDocument<T> {
  frontmatter: T;
  content: string;
}

export type SafeParseResult<T> =
  | { success: true; data: ParsedDocument<T> }
  | { success: false; error: ZodError };

export const parseFrontmatter = <S extends z.ZodTypeAny>(
  markdown: string,
  schema: S
): ParsedDocument<z.output<S>> => {
  const { rawFrontmatter, content } = extractFrontmatter(markdown);
  const parsed = parse(rawFrontmatter);
  const frontmatter = schema.parse(parsed) as z.output<S>;
  return { frontmatter, content };
};

export const safeParseFrontmatter = <S extends z.ZodTypeAny>(
  markdown: string,
  schema: S
): SafeParseResult<z.output<S>> => {
  let rawFrontmatter: string;
  let content: string;

  try {
    const extracted = extractFrontmatter(markdown);
    rawFrontmatter = extracted.rawFrontmatter;
    content = extracted.content;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown frontmatter error";
    return {
      success: false,
      error: new ZodError([
        {
          code: "custom",
          params: { type: "invalid_frontmatter" },
          path: [],
          message
        }
      ])
    };
  }

  const parsed = parse(rawFrontmatter);
  const result = schema.safeParse(parsed);

  if (result.success) {
    return {
      success: true,
      data: { frontmatter: result.data as z.output<S>, content }
    };
  }
  return { success: false, error: result.error };
};

export const serializeFrontmatter = <T extends Record<string, unknown>>(
  doc: ParsedDocument<T>
): string => {
  const prepared = prepareForSerialization(doc.frontmatter);
  const yamlContent = stringify(prepared).trim();
  return `---\n${yamlContent}\n---\n${doc.content}`;
};

export const updateFrontmatter = async <S extends z.ZodTypeAny>(
  filePath: string,
  schema: S,
  updater: (current: z.output<S>) => z.output<S>
): Promise<void> => {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new Error(`File not found: ${filePath}`);
  }

  const markdown = await file.text();
  const { frontmatter, content } = parseFrontmatter(markdown, schema);
  const updated = updater(frontmatter);
  const serialized = serializeFrontmatter({
    frontmatter: updated as Record<string, unknown>,
    content
  });
  await Bun.write(filePath, serialized);
};

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const extractFrontmatter = (
  markdown: string
): { rawFrontmatter: string; content: string } => {
  const match = markdown.match(FRONTMATTER_REGEX);

  if (!match) {
    throw new Error("Invalid frontmatter: missing or malformed delimiters");
  }

  return {
    rawFrontmatter: match[1]!,
    content: match[2]!
  };
};

const prepareValue = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(prepareValue);
  }
  if (typeof value === "object" && value !== null) {
    return prepareForSerialization(value as Record<string, unknown>);
  }
  return value;
};

const prepareForSerialization = (
  obj: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, prepareValue(value)])
  );
