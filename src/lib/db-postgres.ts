import { Pool } from "pg";
import type { Db, DbRow } from "./db";
import { sanitizeConnectionString } from "./db-url";

/** Переводит плейсхолдеры `?` в `$1…$n`. Символ `?` внутри строковых литералов запрещён соглашением. */
function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Минимум от драйвера, который нужен адаптеру. Позволяет подменить пул в проверке.
 * `exec` — для DDL из нескольких операторов: node-postgres выполняет такое только
 * простым протоколом (без массива значений), pglite — через свой `exec`.
 */
export type PgClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  exec?(sql: string): Promise<void>;
};

/**
 * Прод-адаптер PostgreSQL. Пул один на процесс; SSL включается строкой
 * подключения (`?sslmode=require`), как у Neon/Supabase/RDS.
 * Второй аргумент — для проверок (pglite): в продакшене не передаётся.
 */
export function createPostgresDb(connectionString: string, client?: PgClient): Db {
  const pool: PgClient =
    client ??
    (() => {
      // channel_binding из шаблона Neon node-postgres не поддерживает — вырезаем,
      // остальные параметры (sslmode) оставляем.
      const safeUrl = sanitizeConnectionString(connectionString);
      const real = new Pool({
        connectionString: safeUrl,
        max: Number(process.env.PGPOOL_MAX || 5),
        ssl: /sslmode=(require|verify-ca|verify-full)/.test(safeUrl)
          ? { rejectUnauthorized: false }
          : undefined,
      });
      real.on("error", (err) => {
        // Пул живёт дольше одного запроса: ошибка соединения не должна ронять процесс.
        console.error("[db:postgres] idle client error:", err.message);
      });
      return real;
    })();

  async function query<R>(sql: string, params: unknown[]): Promise<R> {
    const started = Date.now();
    try {
      const res = await pool.query(toPgPlaceholders(sql), params);
      return res.rows as R;
    } catch (err) {
      console.error(
        `[db:postgres] query failed after ${Date.now() - started}ms: ${sql.slice(0, 120)}`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  }

  return {
    dialect: "postgres",
    all: <T = DbRow>(sql: string, params: unknown[] = []) => query<T[]>(sql, params),
    get: <T = DbRow>(sql: string, params: unknown[] = []) =>
      query<T[]>(sql, params).then((rows) => rows[0]),
    run: async (sql: string, params: unknown[] = []) => {
      await pool.query(toPgPlaceholders(sql), params);
    },
    exec: async (sql: string) => {
      if (pool.exec) return pool.exec(sql);
      await pool.query(sql);
    },
  };
}
