import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnyJson } from "../db/test-utils.ts";
import { createFsRoutes } from "./routes.ts";

describe("fs routes", () => {
  let testDir: string;
  let routes: ReturnType<typeof createFsRoutes>;

  beforeEach(() => {
    testDir = `/tmp/aop-fs-routes-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
    routes = createFsRoutes();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("GET /directories", () => {
    test("lists directories at specified path", async () => {
      mkdirSync(path.join(testDir, "dir-a"));
      mkdirSync(path.join(testDir, "dir-b"));

      const res = await routes.request(`/directories?path=${encodeURIComponent(testDir)}`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.path).toBe(testDir);
      expect(body.directories).toContain("dir-a");
      expect(body.directories).toContain("dir-b");
    });

    test("defaults to home directory when path omitted", async () => {
      const res = await routes.request("/directories");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.path).toBe(os.homedir());
    });

    test("includes hidden directories when hidden=true", async () => {
      mkdirSync(path.join(testDir, ".hidden"));
      mkdirSync(path.join(testDir, "visible"));

      const res = await routes.request(
        `/directories?path=${encodeURIComponent(testDir)}&hidden=true`,
      );
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.directories).toContain(".hidden");
      expect(body.directories).toContain("visible");
    });

    test("excludes hidden directories by default", async () => {
      mkdirSync(path.join(testDir, ".hidden"));
      mkdirSync(path.join(testDir, "visible"));

      const res = await routes.request(`/directories?path=${encodeURIComponent(testDir)}`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.directories).not.toContain(".hidden");
      expect(body.directories).toContain("visible");
    });

    test("returns 404 for non-existent path", async () => {
      const res = await routes.request("/directories?path=/non/existent/path");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Path not found");
    });

    test("returns 400 for file path", async () => {
      const filePath = path.join(testDir, "file.txt");
      writeFileSync(filePath, "content");

      const res = await routes.request(`/directories?path=${encodeURIComponent(filePath)}`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Path is not a directory");
    });

    test("returns 403 for unreadable path", async () => {
      const restrictedDir = path.join(testDir, "restricted");
      mkdirSync(restrictedDir, { mode: 0o000 });

      const res = await routes.request(`/directories?path=${encodeURIComponent(restrictedDir)}`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(403);
      expect(body.error).toBe("Permission denied");

      // Cleanup: restore permissions
      const { chmodSync } = await import("node:fs");
      chmodSync(restrictedDir, 0o755);
    });

    test("returns parent path in response", async () => {
      const subDir = path.join(testDir, "subdir");
      mkdirSync(subDir);

      const res = await routes.request(`/directories?path=${encodeURIComponent(subDir)}`);
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.parent).toBe(testDir);
    });
  });
});
