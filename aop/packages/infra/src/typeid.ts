import { parseTypeId, type TypeId, typeidUnboxed } from "typeid-js";

export type TypeIdPrefix = "task" | "exec" | "repo" | "step";

const VALID_PREFIXES: Set<TypeIdPrefix> = new Set(["task", "exec", "repo", "step"]);

export const generateTypeId = (prefix: TypeIdPrefix): string => typeidUnboxed(prefix);

export const getTypeIdPrefix = (id: string): TypeIdPrefix | null => {
  try {
    const parsed = parseTypeId(id as TypeId<string>);
    return VALID_PREFIXES.has(parsed.prefix as TypeIdPrefix)
      ? (parsed.prefix as TypeIdPrefix)
      : null;
  } catch {
    return null;
  }
};

export const isValidTypeId = (id: string, expectedPrefix?: TypeIdPrefix): boolean => {
  try {
    const parsed = parseTypeId(id as TypeId<string>);
    if (!parsed.prefix) return false;
    if (expectedPrefix) return parsed.prefix === expectedPrefix;
    return VALID_PREFIXES.has(parsed.prefix as TypeIdPrefix);
  } catch {
    return false;
  }
};
