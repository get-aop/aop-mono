import type { Kysely } from "kysely";
import { sql } from "kysely";
import type {
  Database,
  InteractiveSession,
  InteractiveSessionUpdate,
  NewInteractiveSession,
  NewSessionMessage,
  SessionMessage,
} from "../db/schema.ts";

export interface SessionRepository {
  create: (session: NewInteractiveSession) => Promise<InteractiveSession>;
  get: (id: string) => Promise<InteractiveSession | null>;
  update: (id: string, updates: InteractiveSessionUpdate) => Promise<InteractiveSession | null>;
  getActive: () => Promise<InteractiveSession[]>;
  addMessage: (message: NewSessionMessage) => Promise<SessionMessage>;
  getMessages: (sessionId: string) => Promise<SessionMessage[]>;
}

export const createSessionRepository = (db: Kysely<Database>): SessionRepository => ({
  create: async (session: NewInteractiveSession): Promise<InteractiveSession> => {
    await db.insertInto("interactive_sessions").values(session).execute();
    return db
      .selectFrom("interactive_sessions")
      .selectAll()
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow();
  },

  get: async (id: string): Promise<InteractiveSession | null> => {
    const session = await db
      .selectFrom("interactive_sessions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return session ?? null;
  },

  update: async (
    id: string,
    updates: InteractiveSessionUpdate,
  ): Promise<InteractiveSession | null> => {
    const existing = await db
      .selectFrom("interactive_sessions")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();

    if (!existing) return null;

    await db
      .updateTable("interactive_sessions")
      .set({ ...updates, updated_at: sql`datetime('now')` })
      .where("id", "=", id)
      .execute();

    return db
      .selectFrom("interactive_sessions")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  },

  getActive: async (): Promise<InteractiveSession[]> => {
    return db
      .selectFrom("interactive_sessions")
      .selectAll()
      .where("status", "in", ["active", "brainstorming"])
      .orderBy("created_at", "desc")
      .execute();
  },

  addMessage: async (message: NewSessionMessage): Promise<SessionMessage> => {
    await db.insertInto("session_messages").values(message).execute();
    return db
      .selectFrom("session_messages")
      .selectAll()
      .where("id", "=", message.id)
      .executeTakeFirstOrThrow();
  },

  getMessages: async (sessionId: string): Promise<SessionMessage[]> => {
    return db
      .selectFrom("session_messages")
      .selectAll()
      .where("session_id", "=", sessionId)
      .orderBy("created_at", "asc")
      .execute();
  },
});
