import Database from "better-sqlite3";
import path from "path";

/**
 * Локальная БД — SQLite-файл (better-sqlite3, синхронный, без внешних бинарников).
 * На проде схема переносится в PostgreSQL — см. db-setup.sql в корне и docs/ARCHITECTURE.md.
 */
const dbFile = (process.env.DATABASE_URL || "file:./dev.db").replace(/^file:/, "");
const db = new Database(path.resolve(process.cwd(), dbFile));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
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

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
`);

export default db;
