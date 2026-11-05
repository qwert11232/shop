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

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_order_limits_client ON order_limits(client_key, created_at);
`;

export function createSqliteDb(file: string): Db {
  const db = new Database(path.resolve(process.cwd(), file));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

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
      return prepare(sql).all(...params) as T[];
    },
    async get<T = DbRow>(sql: string, params: unknown[] = []) {
      return prepare(sql).get(...params) as T | undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      prepare(sql).run(...params);
    },
  };
}
