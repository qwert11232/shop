/**
 * Слой доступа к БД: один интерфейс, два диалекта.
 *
 * Диалект выбирается по `DATABASE_URL`:
 *   - `postgres://…` / `postgresql://…` → PostgreSQL (pg, продакшен);
 *   - всё остальное (`file:./dev.db`) → SQLite-файл (better-sqlite3, локальная разработка).
 *
 * Запросы пишутся один раз с плейсхолдерами `?`; PG-адаптер переводит их в `$1…$n`.
 * Ограничение: в тексте запросов не должно быть символа `?` вне плейсхолдера.
 */

export type DbRow = Record<string, unknown>;

export interface Db {
  readonly dialect: "sqlite" | "postgres";
  all<T = DbRow>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = DbRow>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
}

export function databaseUrl(): string {
  return process.env.DATABASE_URL || "file:./dev.db";
}

export function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

let instance: Db | null = null;
let loading: Promise<Db> | null = null;

/** Единственный экземпляр адаптера на процесс (пул соединений не пересоздаётся на каждый запрос). */
export async function getDb(): Promise<Db> {
  if (instance) return instance;
  if (!loading) {
    loading = createDb(databaseUrl()).then((db) => {
      instance = db;
      return db;
    });
  }
  return loading;
}

async function createDb(url: string): Promise<Db> {
  if (isPostgresUrl(url)) {
    const { createPostgresDb } = await import("./db-postgres");
    return createPostgresDb(url);
  }
  const { createSqliteDb } = await import("./db-sqlite");
  return createSqliteDb(url.replace(/^file:/, ""));
}
