import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/index.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createRepoRepository, extractRepoName, type RepoRepository } from "./repository.ts";

describe("RepoRepository", () => {
  let db: Kysely<Database>;
  let repository: RepoRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repository = createRepoRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("create", () => {
    test("creates a new repo with required fields", async () => {
      const repo = await repository.create({
        id: "repo-1",
        path: "/home/user/project",
      });

      expect(repo.id).toBe("repo-1");
      expect(repo.path).toBe("/home/user/project");
      expect(repo.name).toBeNull();
      expect(repo.remote_origin).toBeNull();
      expect(repo.max_concurrent_tasks).toBe(1);
      expect(repo.created_at).toBeDefined();
      expect(repo.updated_at).toBeDefined();
    });

    test("creates a repo with optional fields", async () => {
      const repo = await repository.create({
        id: "repo-1",
        path: "/home/user/project",
        name: "my-project",
        remote_origin: "git@github.com:user/project.git",
        max_concurrent_tasks: 2,
      });

      expect(repo.name).toBe("my-project");
      expect(repo.remote_origin).toBe("git@github.com:user/project.git");
      expect(repo.max_concurrent_tasks).toBe(2);
    });

    test("throws on duplicate path", async () => {
      await repository.create({
        id: "repo-1",
        path: "/home/user/project",
      });

      await expect(
        repository.create({
          id: "repo-2",
          path: "/home/user/project",
        }),
      ).rejects.toThrow();
    });
  });

  describe("getByPath", () => {
    test("returns repo by path", async () => {
      await repository.create({
        id: "repo-1",
        path: "/home/user/project",
      });

      const repo = await repository.getByPath("/home/user/project");

      expect(repo).not.toBeNull();
      expect(repo?.id).toBe("repo-1");
    });

    test("returns null for non-existent path", async () => {
      const repo = await repository.getByPath("/non/existent");

      expect(repo).toBeNull();
    });
  });

  describe("getById", () => {
    test("returns repo by id", async () => {
      await repository.create({
        id: "repo-1",
        path: "/home/user/project",
      });

      const repo = await repository.getById("repo-1");

      expect(repo).not.toBeNull();
      expect(repo?.path).toBe("/home/user/project");
    });

    test("returns null for non-existent id", async () => {
      const repo = await repository.getById("non-existent");

      expect(repo).toBeNull();
    });
  });

  describe("getAll", () => {
    test("returns all repos", async () => {
      await repository.create({ id: "repo-1", path: "/home/user/project-a" });
      await repository.create({ id: "repo-2", path: "/home/user/project-b" });

      const repos = await repository.getAll();

      expect(repos).toHaveLength(2);
    });

    test("returns empty array when no repos", async () => {
      const repos = await repository.getAll();

      expect(repos).toHaveLength(0);
    });
  });

  describe("remove", () => {
    test("removes existing repo and returns true", async () => {
      await repository.create({ id: "repo-1", path: "/home/user/project" });

      const removed = await repository.remove("repo-1");

      expect(removed).toBe(true);
      expect(await repository.getById("repo-1")).toBeNull();
    });

    test("returns false for non-existent repo", async () => {
      const removed = await repository.remove("non-existent");

      expect(removed).toBe(false);
    });
  });
});

describe("extractRepoName", () => {
  test("extracts name from path", () => {
    expect(extractRepoName("/home/user/my-project")).toBe("my-project");
    expect(extractRepoName("/home/user/project/")).toBe("project");
    expect(extractRepoName("project")).toBe("project");
  });
});
