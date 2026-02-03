import type { Kysely } from "kysely";
import type { Database, NewRepo, Repo } from "../db/schema.ts";

export interface RepoRepository {
  findById: (id: string) => Promise<Repo | null>;
  upsert: (repo: NewRepo) => Promise<Repo>;
}

export const createRepoRepository = (db: Kysely<Database>): RepoRepository => ({
  findById: async (id: string): Promise<Repo | null> => {
    const repo = await db.selectFrom("repos").selectAll().where("id", "=", id).executeTakeFirst();
    return repo ?? null;
  },

  upsert: async (repo: NewRepo): Promise<Repo> => {
    return db
      .insertInto("repos")
      .values(repo)
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          synced_at: repo.synced_at,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  },
});
