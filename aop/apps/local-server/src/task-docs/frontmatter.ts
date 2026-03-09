import { parse, stringify } from "yaml";

export interface ParsedDocument<T> {
  frontmatter: T;
  content: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export const parseFrontmatter = <T>(markdown: string): ParsedDocument<T> => {
  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) {
    throw new Error("Invalid frontmatter: missing or malformed delimiters");
  }

  return {
    frontmatter: parse(match[1] ?? "") as T,
    content: match[2] ?? "",
  };
};

export const serializeFrontmatter = <T extends Record<string, unknown>>(
  doc: ParsedDocument<T>,
): string => {
  const yamlContent = stringify(doc.frontmatter).trim();
  return `---\n${yamlContent}\n---\n${doc.content}`;
};

export const updateFrontmatter = async <T extends Record<string, unknown>>(
  filePath: string,
  updater: (current: T) => T,
): Promise<void> => {
  const markdown = await Bun.file(filePath).text();
  const { frontmatter, content } = parseFrontmatter<T>(markdown);
  await Bun.write(
    filePath,
    serializeFrontmatter({
      frontmatter: updater(frontmatter),
      content,
    }),
  );
};
