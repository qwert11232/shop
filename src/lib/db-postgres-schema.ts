import type { Db } from "./db";

/**
 * Схема PostgreSQL — тот же DDL, что в db-setup.sql (версия 0002).
 * Выполняется автоматически при первом подключении на управляемой базе:
 * на Neon/Supabase нет ни CLI миграций, ни доступа к файловой системе,
 * поэтому без этого каталог отвечает 500 «relation does not exist».
 *
 * Правило синхронизации: любой DDL в db-setup.sql повторяется здесь в том же
 * коммите, иначе деплой и ручная установка схемы начнут расходиться.
 * Проверяется `npm run check:pg` — она гоняет те же запросы на pglite.
 */
export const POSTGRES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL,
  photo_url   TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  category_id TEXT NOT NULL REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'new',
  comment           TEXT NOT NULL DEFAULT '',
  tg_user_id        TEXT,
  first_name        TEXT,
  username          TEXT,
  group_message_id  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  product_id        TEXT NOT NULL REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS order_limits (
  client_key  TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_order_limits_client ON order_limits(client_key, created_at);
`;

let applied: Promise<void> | null = null;

/** Идемпотентно; один раз на процесс, ошибки не глотаются — их видно в логе. */
export function ensurePostgresSchema(db: Db): Promise<void> {
  if (!applied) {
    applied = (async () => {
      try {
        await db.exec(POSTGRES_SCHEMA_SQL);
        console.log("[db:postgres] схема проверена (DDL из db-setup.sql)");
      } catch (err) {
        applied = null;
        console.error(
          "[db:postgres] не удалось применить схему:",
          err instanceof Error ? err.message : err,
        );
        throw err;
      }
    })();
  }
  return applied;
}
