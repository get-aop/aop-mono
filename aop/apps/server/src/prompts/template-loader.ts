import { dirname, join } from "node:path";

export interface TemplateLoader {
  load: (filename: string) => Promise<string>;
  clearCache: () => void;
}

const TEMPLATES_DIR = join(dirname(import.meta.path), "templates");

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
      cache.set(filename, content);

      return content;
    },

    clearCache: () => {
      cache.clear();
    },
  };
};
