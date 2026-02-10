import { dirname, join } from "node:path";

export interface TemplateLoader {
  load: (filename: string) => Promise<string>;
  clearCache: () => void;
}

const TEMPLATES_DIR = join(dirname(import.meta.path), "templates");

const resolvePartials = async (content: string): Promise<string> => {
  const partialPattern = /\{\{>\s*(\S+)\s*\}\}/g;
  const matches = [...content.matchAll(partialPattern)];

  if (matches.length === 0) return content;

  let resolved = content;
  for (const match of matches) {
    const partialName = match[1];
    const partialPath = join(TEMPLATES_DIR, `_${partialName}.md.hbs`);
    const file = Bun.file(partialPath);

    if (!(await file.exists())) {
      throw new Error(`Partial not found: _${partialName}.md.hbs`);
    }

    const partialContent = await file.text();
    resolved = resolved.replace(match[0], partialContent.trimEnd());
  }

  return resolved;
};

export const createTemplateLoader = (): TemplateLoader => {
  const cache = new Map<string, string>();

  return {
    load: async (filename: string): Promise<string> => {
      const cached = cache.get(filename);
      if (cached) {
        return cached;
      }

      const filePath = join(TEMPLATES_DIR, filename);
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        throw new Error(`Template not found: ${filePath}`);
      }

      const content = await file.text();
      const resolved = await resolvePartials(content);
      cache.set(filename, resolved);

      return resolved;
    },

    clearCache: () => {
      cache.clear();
    },
  };
};
