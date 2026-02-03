import type { Kysely } from "kysely";
import type { Client, Database, NewClient } from "../db/schema.ts";

export interface ClientRepository {
  findByApiKey: (apiKey: string) => Promise<Client | null>;
  create: (client: NewClient) => Promise<Client>;
  updateLastSeen: (id: string, lastSeenAt: Date) => Promise<Client | null>;
}

export const createClientRepository = (db: Kysely<Database>): ClientRepository => ({
  findByApiKey: async (apiKey: string): Promise<Client | null> => {
    const client = await db
      .selectFrom("clients")
      .selectAll()
      .where("api_key", "=", apiKey)
      .executeTakeFirst();
    return client ?? null;
  },

  create: async (client: NewClient): Promise<Client> => {
    return db.insertInto("clients").values(client).returningAll().executeTakeFirstOrThrow();
  },

  updateLastSeen: async (id: string, lastSeenAt: Date): Promise<Client | null> => {
    const updated = await db
      .updateTable("clients")
      .set({ last_seen_at: lastSeenAt })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return updated ?? null;
  },
});
