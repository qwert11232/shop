import { Pool } from "pg";
import type { Db, DbRow } from "./db";

/** `?` → `$1…$n`; двойной апостроф и другие `?` внутри литералов запрещены соглашением. */
function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Минимум от драйвера, который нужен адаптеру. Позволяет подменить пул в проверке. */
export type PgClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

/**
 * Прод-адаптер PostgreSQL. Пул один на процесс; SSL включается строкой
 * подключения (`?sslmode=require`), как у Neon/Supabase/RDS.
 * Второй аргумент — для проверок (pglite): в продакшене не передаётся.
 */
export function createPostgresDb(connectionString: string, client?: PgClient): Db {
  const pool: PgClient =
    client ??
    (() => {
      const real = new Pool({
        connectionString,
        max: Number(process.env.PGPOOL_MAX || 5),
        ssl: /sslmode=(require|verify-ca|verify-full)/.test(connectionString)
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
  };
}
