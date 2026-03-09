import { describe, expect, test } from "bun:test";
import { normalizeReleaseVersion } from "./versioning";

describe("normalizeReleaseVersion", () => {
  test("strips leading v from tags", () => {
    expect(normalizeReleaseVersion("v0.1.7")).toBe("0.1.7");
  });

  test("keeps plain semver untouched", () => {
    expect(normalizeReleaseVersion("0.1.7")).toBe("0.1.7");
  });

  test("accepts prerelease versions", () => {
    expect(normalizeReleaseVersion("v0.1.7-beta.1")).toBe("0.1.7-beta.1");
  });

  test("throws on invalid version", () => {
    expect(() => normalizeReleaseVersion("release-17")).toThrow(
      'Invalid release version "release-17"',
    );
  });
});
