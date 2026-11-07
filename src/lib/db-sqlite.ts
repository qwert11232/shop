import Database from "better-sqlite3";
import path from "path";
import type { Db, DbRow } from "./db";

/**
 * Локальная БД — SQLite-файл (better-sqlite3). Схема создаётся автоматически,
 * чтобы `npm run dev` работал на чистом клоне без миграций.
 * Продакшен-схема — PostgreSQL, см. db-setup.sql.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📦',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL,          -- копейки
  photo_url   TEXT NOT NULL,
  -- Старая цена для витрины: price — то, что платит клиент. Так корзина,
  -- заказы и бот работают с одной актуальной ценой, а скидка живёт только
  -- в показе. 0 — скидки нет.
  old_price   INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
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
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  product_id        TEXT NOT NULL REFERENCES products(id)
);

-- Лимиты заявок в БД: общие для всех инстансов, переживают рестарт.
CREATE TABLE IF NOT EXISTS order_limits (
  client_key   TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

-- Варианты товара: цвет, объём памяти, комплектация. Цена — копейки.
CREATE TABLE IF NOT EXISTS product_variants (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'variant',
  extra      INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

-- Характеристики: «память 256 ГБ», «мощность 1600 Вт» — по ним идёт сравнение.
CREATE TABLE IF NOT EXISTS product_specs (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL DEFAULT 'Основное',
  name       TEXT NOT NULL,
  value      TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT '',
  numeric    REAL,
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

-- Отзывы: только после доставки заказа; один отзыв на товар от пользователя.
CREATE TABLE IF NOT EXISTS reviews (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tg_user_id TEXT NOT NULL,
  author     TEXT NOT NULL,
  rating     INTEGER NOT NULL,
  text       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  tg_user_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tg_user_id, product_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id         TEXT PRIMARY KEY,
  tg_user_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id TEXT,
  quantity   INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- Профиль клиента: телефон и имя для быстрого оформления, бонусный баланс.
CREATE TABLE IF NOT EXISTS customers (
  tg_user_id    TEXT PRIMARY KEY,
  first_name    TEXT NOT NULL DEFAULT '',
  username      TEXT NOT NULL DEFAULT '',
  phone         TEXT NOT NULL DEFAULT '',
  bonus_balance INTEGER NOT NULL DEFAULT 0,
  referral_code TEXT NOT NULL DEFAULT '',
  referred_by   TEXT,
  created_at    INTEGER NOT NULL
);

-- Движение бонусов: начисление, списание, реферал. Баланс всегда выводим из журнала.
CREATE TABLE IF NOT EXISTS bonus_events (
  id         TEXT PRIMARY KEY,
  tg_user_id TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  order_id   TEXT,
  created_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL
);

-- Состояние диалога админ-бота: переживает холодный старт инстанса.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_state (
  chat_id    TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(tg_user_id);
CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_media_product ON product_media(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_unique ON cart_items(tg_user_id, product_id, COALESCE(variant_id, ''));
CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(tg_user_id);
CREATE INDEX IF NOT EXISTS idx_bonus_user ON bonus_events(tg_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_order_limits_client ON order_limits(client_key, created_at);
`;

/**
 * Догоняющие колонки для баз, созданных до появления корзины и доставки.
 * SQLite не умеет `ADD COLUMN IF NOT EXISTS`, поэтому состав колонок
 * сверяется через pragma — повторный запуск безопасен.
 */
function migrateSqlite(db: Database.Database): void {
  const columns = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

  const ensure = (table: string, column: string, ddl: string) => {
    if (!columns(table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };

  ensure("orders", "delivery_status", "TEXT NOT NULL DEFAULT 'new'");
  ensure("orders", "track_number", "TEXT NOT NULL DEFAULT ''");
  ensure("orders", "total", "INTEGER NOT NULL DEFAULT 0");
  ensure("orders", "bonus_used", "INTEGER NOT NULL DEFAULT 0");
  ensure("orders", "bonus_earned", "INTEGER NOT NULL DEFAULT 0");
  ensure("orders", "contact_name", "TEXT NOT NULL DEFAULT ''");
  ensure("orders", "contact_phone", "TEXT NOT NULL DEFAULT ''");
  ensure("products", "brand", "TEXT NOT NULL DEFAULT ''");
  ensure("products", "old_price", "INTEGER NOT NULL DEFAULT 0");

  // Корзина: раньше ключом было (tg_user_id, product_id, variant_id) и все
  // обращения шли по этим колонкам. Теперь строка адресуется по `id`, поэтому
  // старую таблицу пересобираем — SQLite не умеет менять первичный ключ.
  // На PostgreSQL то же самое делает DO-блок в db-setup.sql.
  if (!columns("cart_items").includes("id")) {
    db.exec(`
      ALTER TABLE cart_items RENAME TO cart_items_old;
      CREATE TABLE cart_items (
        id         TEXT PRIMARY KEY,
        tg_user_id TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        variant_id TEXT,
        quantity   INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO cart_items (id, tg_user_id, product_id, variant_id, quantity, updated_at)
        SELECT 'ci-' || lower(hex(randomblob(6))), tg_user_id, product_id, variant_id, quantity, updated_at
        FROM cart_items_old;
      DROP TABLE cart_items_old;
    `);
  }
}

export function createSqliteDb(file: string): Db {
  const db = new Database(path.resolve(process.cwd(), file));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrateSqlite(db);

  /**
   * SQLite не умеет bind для boolean: `false` роняет запрос целиком.
   * Приводим флаги к 1/0 здесь, а не в каждом вызове: иначе любое новое
   * место с `is_active` падало бы только на локальной базе, а на PG работало.
   */
  function bindable(params: unknown[]): unknown[] {
    return params.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : value));
  }

  function prepare(sql: string) {
    try {
      return db.prepare(sql);
    } catch (err) {
      console.error(`[db:sqlite] prepare failed: ${sql.slice(0, 120)}`, err);
      throw err;
    }
  }

  return {
    dialect: "sqlite",
    async all<T = DbRow>(sql: string, params: unknown[] = []) {
      return prepare(sql).all(...bindable(params)) as T[];
    },
    async get<T = DbRow>(sql: string, params: unknown[] = []) {
      return prepare(sql).get(...bindable(params)) as T | undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      prepare(sql).run(...bindable(params));
    },
    async exec(sql: string) {
      db.exec(sql);
    },
  };
}
