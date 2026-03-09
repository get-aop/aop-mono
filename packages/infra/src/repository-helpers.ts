import type { Insertable, Kysely, Selectable, Updateable } from "kysely";

/**
 * Creates generic CRUD helper functions for a Kysely table.
 *
 * Works with both Postgres (Bun.sql) and SQLite (bun:sqlite) dialects
 * by avoiding `returningAll()` — uses insert/update + re-select instead,
 * wrapped in transactions for atomicity.
 *
 * Only tables with a string `id` column are supported.
 * The caller must provide `id` in the insert data.
 */
export const createCrudHelpers = <DB, TableName extends keyof DB & string>(
  db: Kysely<DB>,
  table: TableName,
) => {
  // Kysely's type system uses complex conditional types on `.where()` that
  // become unresolvable when both DB and TableName are generic. We cast to
  // a concrete Kysely<any> with a concrete table name internally, keeping
  // the public API fully typed via Selectable/Insertable/Updateable.
  const k = db as unknown as Kysely<Record<string, Record<string, unknown>>>;
  const t = table as string;

  return {
    findById: async (id: string): Promise<Selectable<DB[TableName]> | null> => {
      const row = await k.selectFrom(t).selectAll().where("id", "=", id).executeTakeFirst();
      return (row ?? null) as Selectable<DB[TableName]> | null;
    },

    create: async (data: Insertable<DB[TableName]>): Promise<Selectable<DB[TableName]>> => {
      const id = (data as Record<string, unknown>).id;
      if (typeof id !== "string") {
        throw new Error(`createCrudHelpers.create: 'id' must be a string, got ${typeof id}`);
      }

      return k.transaction().execute(async (trx) => {
        await trx
          .insertInto(t)
          .values(data as Record<string, unknown>)
          .execute();

        const inserted = await trx
          .selectFrom(t)
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

        return inserted as Selectable<DB[TableName]>;
      });
    },

    update: async (
      id: string,
      data: Updateable<DB[TableName]>,
    ): Promise<Selectable<DB[TableName]> | null> => {
      // Wrapped in a transaction for atomicity between the existence check,
      // update, and re-select. Using select-first because BunSqliteDialect
      // does not report numUpdatedRows accurately.
      return k.transaction().execute(async (trx) => {
        const existing = await trx
          .selectFrom(t)
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst();
        if (!existing) return null;

        await trx
          .updateTable(t)
          .set(data as Record<string, unknown>)
          .where("id", "=", id)
          .execute();

        const updated = await trx.selectFrom(t).selectAll().where("id", "=", id).executeTakeFirst();
        return (updated ?? null) as Selectable<DB[TableName]> | null;
      });
    },

    listAll: async (): Promise<Selectable<DB[TableName]>[]> => {
      const rows = await k.selectFrom(t).selectAll().execute();
      return rows as Selectable<DB[TableName]>[];
    },

    deleteById: async (id: string): Promise<boolean> => {
      // Using select-first because BunSqliteDialect does not report
      // numDeletedRows accurately (always returns 0n).
      const existing = await k.selectFrom(t).selectAll().where("id", "=", id).executeTakeFirst();
      if (!existing) return false;

      await k.deleteFrom(t).where("id", "=", id).execute();
      return true;
    },
  };
};

export type CrudHelpers<DB, TableName extends keyof DB & string> = ReturnType<
  typeof createCrudHelpers<DB, TableName>
>;
