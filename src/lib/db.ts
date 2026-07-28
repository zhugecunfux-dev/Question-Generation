import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { BankEntry, Difficulty, Question, QuestionFormat, QuestionTemplate } from "@/lib/types";

const DB_PATH = process.env.QG_DB_PATH
  ? path.resolve(process.env.QG_DB_PATH)
  : path.join(process.cwd(), "data", "bank.sqlite");

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL CHECK (kind IN ('static', 'template')),
      topic_id    TEXT NOT NULL,
      subtopic_id TEXT,
      format      TEXT NOT NULL,
      difficulty  TEXT NOT NULL,
      ao          TEXT NOT NULL,
      marks       INTEGER NOT NULL,
      source      TEXT NOT NULL,
      tags        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      payload     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entries_topic  ON entries (topic_id);
    CREATE INDEX IF NOT EXISTS idx_entries_kind   ON entries (kind);
    CREATE INDEX IF NOT EXISTS idx_entries_format ON entries (format);
  `);
  return db;
}

function toRow(entry: BankEntry) {
  return {
    id: entry.id,
    kind: entry.kind,
    topic_id: entry.topicId,
    subtopic_id: entry.subtopicId ?? null,
    format: entry.format,
    difficulty: entry.difficulty,
    ao: entry.ao,
    marks: entry.marks,
    source: entry.source,
    tags: entry.tags.join(","),
    created_at: entry.createdAt,
    payload: JSON.stringify(entry),
  };
}

interface Row {
  payload: string;
}

/** Insert or replace entries. Returns the number written. */
export function upsertEntries(entries: BankEntry[]): number {
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO entries (id, kind, topic_id, subtopic_id, format, difficulty, ao, marks, source, tags, created_at, payload)
    VALUES (@id, @kind, @topic_id, @subtopic_id, @format, @difficulty, @ao, @marks, @source, @tags, @created_at, @payload)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind, topic_id = excluded.topic_id, subtopic_id = excluded.subtopic_id,
      format = excluded.format, difficulty = excluded.difficulty, ao = excluded.ao,
      marks = excluded.marks, source = excluded.source, tags = excluded.tags,
      created_at = excluded.created_at, payload = excluded.payload
  `);
  const run = database.transaction((batch: BankEntry[]) => {
    for (const entry of batch) stmt.run(toRow(entry));
    return batch.length;
  });
  return run(entries);
}

export interface QueryFilters {
  kind?: "static" | "template";
  topicIds?: string[];
  formats?: QuestionFormat[];
  difficulties?: Difficulty[];
  search?: string;
  limit?: number;
  offset?: number;
}

function buildWhere(filters: QueryFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.kind) {
    clauses.push("kind = ?");
    params.push(filters.kind);
  }
  if (filters.topicIds?.length) {
    clauses.push(`topic_id IN (${filters.topicIds.map(() => "?").join(",")})`);
    params.push(...filters.topicIds);
  }
  if (filters.formats?.length) {
    clauses.push(`format IN (${filters.formats.map(() => "?").join(",")})`);
    params.push(...filters.formats);
  }
  if (filters.difficulties?.length) {
    clauses.push(`difficulty IN (${filters.difficulties.map(() => "?").join(",")})`);
    params.push(...filters.difficulties);
  }
  if (filters.search?.trim()) {
    clauses.push("payload LIKE ?");
    params.push(`%${filters.search.trim()}%`);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function queryEntries(filters: QueryFilters = {}): BankEntry[] {
  const { sql, params } = buildWhere(filters);
  const limit = Math.min(filters.limit ?? 100, 500);
  const offset = filters.offset ?? 0;
  const rows = getDb()
    .prepare(`SELECT payload FROM entries ${sql} ORDER BY topic_id, id LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Row[];
  return rows.map((r) => JSON.parse(r.payload) as BankEntry);
}

export function countEntries(filters: QueryFilters = {}): number {
  const { sql, params } = buildWhere(filters);
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM entries ${sql}`)
    .get(...params) as { n: number };
  return row.n;
}

export function getStaticQuestions(filters: QueryFilters = {}): Question[] {
  return queryEntries({ ...filters, kind: "static" }) as Question[];
}

export function getTemplates(filters: QueryFilters = {}): QuestionTemplate[] {
  return queryEntries({ ...filters, kind: "template" }) as QuestionTemplate[];
}

/** Per-topic counts, for the coverage view. */
export function topicCounts(): Array<{ topicId: string; kind: string; n: number }> {
  return getDb()
    .prepare("SELECT topic_id AS topicId, kind, COUNT(*) AS n FROM entries GROUP BY topic_id, kind")
    .all() as Array<{ topicId: string; kind: string; n: number }>;
}

export function deleteEntry(id: string): boolean {
  return getDb().prepare("DELETE FROM entries WHERE id = ?").run(id).changes > 0;
}
