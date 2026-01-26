import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const templateCache = new Map<string, string>();

export const loadTemplate = async (name: string): Promise<string> => {
  const cached = templateCache.get(name);
  if (cached) return cached;

  const path = join(__dirname, `${name}.md`);
  const content = await Bun.file(path).text();
  templateCache.set(name, content);
  return content;
};

export const renderTemplate = (
  template: string,
  vars: Record<string, string>
): string => {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template
  );
};

export const getTemplate = async (
  name: string,
  vars: Record<string, string>
): Promise<string> => {
  const template = await loadTemplate(name);
  return renderTemplate(template, vars);
};
