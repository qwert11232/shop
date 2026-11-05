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
  /** Несколько операторов без параметров (DDL схемы). Простой протокол, без плейсхолдеров. */
  exec(sql: string): Promise<void>;
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

/**
 * Подмена адаптера для проверок (scripts/check-postgres.ts): позволяет прогнать
 * настоящие repo/seed-функции на pglite вместо боевой базы. В приложении не вызывается.
 */
export function __setDbForCheck(db: Db | null): void {
  instance = db;
  loading = db ? Promise.resolve(db) : null;
}

async function createDb(url: string): Promise<Db> {
  if (isPostgresUrl(url)) {
    const { createPostgresDb } = await import("./db-postgres");
    const { ensurePostgresSchema } = await import("./db-postgres-schema");
    const db = createPostgresDb(url);
    // На управляемой базе (Neon/Supabase) схему некому накатить: CLI миграций нет.
    // Идемпотентный DDL из db-setup.sql выполняется один раз на процесс.
    await ensurePostgresSchema(db);
    return db;
  }
  const { createSqliteDb } = await import("./db-sqlite");
  return createSqliteDb(url.replace(/^file:/, ""));
}
