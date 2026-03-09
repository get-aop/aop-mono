const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const normalizeReleaseVersion = (input: string): string => {
  const normalized = input.trim().replace(/^v/, "");

  if (!SEMVER_PATTERN.test(normalized)) {
    throw new Error(`Invalid release version "${input}"`);
  }

  return normalized;
};
