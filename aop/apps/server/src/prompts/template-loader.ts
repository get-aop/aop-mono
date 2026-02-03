import { dirname, join } from "node:path";
import type { StepType } from "../workflow/types.ts";

export interface TemplateLoader {
  load: (stepType: StepType) => Promise<string>;
  clearCache: () => void;
}

const TEMPLATES_DIR = join(dirname(import.meta.path), "templates");

const templateFileNames: Record<StepType, string> = {
  implement: "implement.md.hbs",
  test: "test.md.hbs",
  review: "review.md.hbs",
  debug: "debug.md.hbs",
  iterate: "iterate.md.hbs",
};

export const createTemplateLoader = (): TemplateLoader => {
  const cache = new Map<StepType, string>();

  return {
    load: async (stepType: StepType): Promise<string> => {
      const cached = cache.get(stepType);
      if (cached) {
        return cached;
      }

      const fileName = templateFileNames[stepType];
      if (!fileName) {
        throw new Error(`Unknown step type: ${stepType}`);
      }

      const filePath = join(TEMPLATES_DIR, fileName);
      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        throw new Error(`Template not found: ${filePath}`);
      }

      const content = await file.text();
      cache.set(stepType, content);

      return content;
    },

    clearCache: () => {
      cache.clear();
    },
  };
};
