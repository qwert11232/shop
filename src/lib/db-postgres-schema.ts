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

CREATE TABLE IF NOT EXISTS product_variants (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'variant',
  extra      INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS product_specs (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL DEFAULT 'Основное',
  name       TEXT NOT NULL,
  value      TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT '',
  numeric    DOUBLE PRECISION,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, name)
);

CREATE TABLE IF NOT EXISTS product_media (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'image',
  url        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reviews (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tg_user_id TEXT NOT NULL,
  author     TEXT NOT NULL,
  rating     INTEGER NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  tg_user_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tg_user_id, product_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  tg_user_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id TEXT,
  quantity   INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tg_user_id, product_id, variant_id)
);

CREATE TABLE IF NOT EXISTS customers (
  tg_user_id    TEXT PRIMARY KEY,
  first_name    TEXT NOT NULL DEFAULT '',
  username      TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  bonus_balance INTEGER NOT NULL DEFAULT 0,
  referral_code TEXT NOT NULL DEFAULT '',
  referred_by   TEXT,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS bonus_events (
  id         TEXT PRIMARY KEY,
  tg_user_id TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  order_id   TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  title      TEXT NOT NULL,
  variant    TEXT NOT NULL DEFAULT '',
  price      INTEGER NOT NULL,
  quantity   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_state (
  chat_id    TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(tg_user_id);
CREATE INDEX IF NOT EXISTS idx_order_limits_client ON order_limits(client_key, created_at);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_media_product ON product_media(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(tg_user_id);
CREATE INDEX IF NOT EXISTS idx_bonus_user ON bonus_events(tg_user_id, created_at);
`;

/**
 * Догоняющие колонки. Выполняются после DDL: база могла быть создана раньше,
 * когда корзины, доставки и брендов ещё не было. Идемпотентно.
 */
export const POSTGRES_MIGRATIONS_SQL = `
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS track_number   TEXT NOT NULL DEFAULT '';
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS total          INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS bonus_used     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS bonus_earned   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS contact_name   TEXT NOT NULL DEFAULT '';
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS contact_phone  TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand          TEXT NOT NULL DEFAULT '';
`;
let applied: Promise<void> | null = null;

/** Идемпотентно; один раз на процесс, ошибки не глотаются — их видно в логе. */
export function ensurePostgresSchema(db: Db): Promise<void> {
  if (!applied) {
    applied = (async () => {
      try {
        await db.exec(POSTGRES_SCHEMA_SQL);
        await db.exec(POSTGRES_MIGRATIONS_SQL);
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
