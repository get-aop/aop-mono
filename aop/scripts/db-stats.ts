#!/usr/bin/env bun

/* biome-ignore-all lint/suspicious/noConsole: CLI script */
/**
 * Print SQLite database stats at a glance.
 *
 * Usage:
 *   bun scripts/db-stats.ts              # uses ~/.aop/aop.sqlite
 *   bun scripts/db-stats.ts /path/to.db  # any SQLite file
 */

import { Database } from "bun:sqlite";
import { aopPaths } from "@aop/infra";
import { $ } from "bun";

const dbPath = process.argv[2] ?? aopPaths.db();

const ensureAnalyzed = (path: string): void => {
  const tmp = new Database(path);
  const hasStat1 = tmp
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'")
    .get();
  if (!hasStat1) tmp.run("ANALYZE");
  tmp.close();
};

const scalar = <T>(db: Database, sql: string, param: string): T => {
  const row = db.query<Record<string, T>, [string]>(sql).get(param);
  return Object.values(row ?? {})[0] as T;
};

// bun:sqlite lacks SQLITE_ENABLE_DBSTAT_VTAB on Linux; shell out to system sqlite3
const dbstatQuery = async (sql: string): Promise<string> => {
  const result = await $`sqlite3 ${dbPath} ${sql}`.text();
  return result.trim();
};

const tableSizes = async (
  tableNames: string[],
): Promise<Map<string, { dataBytes: number; idxBytes: number }>> => {
  const sizes = new Map<string, { dataBytes: number; idxBytes: number }>();
  const dataRaw = await dbstatQuery(
    `SELECT name, SUM(pgsize) FROM dbstat WHERE name IN (${tableNames.map((n) => `'${n}'`).join(",")}) GROUP BY name`,
  );
  for (const line of dataRaw.split("\n").filter(Boolean)) {
    const [name = "", bytes = "0"] = line.split("|");
    sizes.set(name, { dataBytes: Number(bytes), idxBytes: 0 });
  }
  const idxRaw = await dbstatQuery(
    `SELECT i.tbl_name, SUM(d.pgsize) FROM dbstat d JOIN sqlite_master i ON d.name = i.name WHERE i.type='index' AND i.tbl_name IN (${tableNames.map((n) => `'${n}'`).join(",")}) GROUP BY i.tbl_name`,
  );
  for (const line of idxRaw.split("\n").filter(Boolean)) {
    const [name = "", bytes = "0"] = line.split("|");
    const entry = sizes.get(name) ?? { dataBytes: 0, idxBytes: 0 };
    entry.idxBytes = Number(bytes);
    sizes.set(name, entry);
  }
  return sizes;
};

ensureAnalyzed(dbPath);
const db = new Database(dbPath, { readonly: true });

const tables = db
  .query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  .all();

const sizes = await tableSizes(tables.map((t) => t.name));

type Row = {
  tbl: string;
  rows: number;
  cols: number;
  idxs: number;
  data_bytes: number;
  idx_bytes: number;
};

const stats: Row[] = tables.map(({ name }) => ({
  tbl: name,
  rows: scalar<number>(
    db,
    "SELECT COALESCE((SELECT CAST(stat AS INTEGER) FROM sqlite_stat1 WHERE tbl = ? LIMIT 1), 0) AS v",
    name,
  ),
  cols: scalar<number>(db, "SELECT COUNT(*) AS v FROM pragma_table_info(?)", name),
  idxs: scalar<number>(
    db,
    "SELECT COUNT(*) AS v FROM sqlite_master WHERE type='index' AND tbl_name = ?",
    name,
  ),
  data_bytes: sizes.get(name)?.dataBytes ?? 0,
  idx_bytes: sizes.get(name)?.idxBytes ?? 0,
}));

db.close();

const humanSize = (bytes: number): string => {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

const sorted = stats.toSorted((a, b) => b.rows - a.rows || a.tbl.localeCompare(b.tbl));

const totalRows = sorted.reduce((s, r) => s + r.rows, 0);
const totalData = sorted.reduce((s, r) => s + r.data_bytes, 0);
const totalIdx = sorted.reduce((s, r) => s + r.idx_bytes, 0);

const header = {
  tbl: "TABLE",
  rows: "ROWS",
  cols: "COLS",
  idxs: "IDXS",
  data: "DATA",
  idx: "INDEX",
  avg: "AVG/ROW",
};

const displayRows = sorted.map((r) => ({
  tbl: r.tbl,
  rows: String(r.rows),
  cols: String(r.cols),
  idxs: String(r.idxs),
  data: humanSize(r.data_bytes),
  idx: humanSize(r.idx_bytes),
  avg: r.rows > 0 ? humanSize(Math.round(r.data_bytes / r.rows)) : "-",
}));

const totals = {
  tbl: "TOTAL",
  rows: String(totalRows),
  cols: "",
  idxs: "",
  data: humanSize(totalData),
  idx: humanSize(totalIdx),
  avg: totalRows > 0 ? humanSize(Math.round(totalData / totalRows)) : "-",
};

const allRows = [header, ...displayRows, totals];
const w = {
  tbl: Math.max(...allRows.map((r) => r.tbl.length)),
  rows: Math.max(...allRows.map((r) => r.rows.length)),
  cols: Math.max(...allRows.map((r) => r.cols.length)),
  idxs: Math.max(...allRows.map((r) => r.idxs.length)),
  data: Math.max(...allRows.map((r) => r.data.length)),
  idx: Math.max(...allRows.map((r) => r.idx.length)),
  avg: Math.max(...allRows.map((r) => r.avg.length)),
};

const fmt = (r: (typeof allRows)[number]) =>
  `  ${r.tbl.padEnd(w.tbl)}  ${r.rows.padStart(w.rows)}  ${r.cols.padStart(w.cols)}  ${r.idxs.padStart(w.idxs)}  ${r.data.padStart(w.data)}  ${r.idx.padStart(w.idx)}  ${r.avg.padStart(w.avg)}`;

const sep = `  ${"─".repeat(w.tbl)}  ${"─".repeat(w.rows)}  ${"─".repeat(w.cols)}  ${"─".repeat(w.idxs)}  ${"─".repeat(w.data)}  ${"─".repeat(w.idx)}  ${"─".repeat(w.avg)}`;

const output = [
  `\n  ${dbPath}\n`,
  fmt(header),
  sep,
  ...displayRows.map((r) => fmt(r)),
  sep,
  fmt(totals),
  "",
].join("\n");

process.stdout.write(output);
