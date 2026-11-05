-- ============================================================================
--  db-setup.sql — ТЕХНОЛАБ · схема БД для managed PostgreSQL (Neon/Supabase/RDS)
--  Версия схемы: 0002 · Дата: 2026-11-05 · PostgreSQL 15+
--
--  Локально приложение использует SQLite (схема создаётся автоматически в
--  src/lib/db.ts). Этот файл — для продакшена: поднимает схему одной вставкой
--  на чистой базе. Повторный запуск безопасен (IF NOT EXISTS).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '📦',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL,               -- копейки, без float
  photo_url   TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  category_id TEXT NOT NULL REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'new',   -- new|contacted|done|cancelled
  comment           TEXT NOT NULL DEFAULT '',
  tg_user_id        TEXT,
  first_name        TEXT,
  username          TEXT,
  group_message_id  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  product_id        TEXT NOT NULL REFERENCES products(id)
);

-- Антифлуд заявок: общее состояние для всех инстансов (см. reserveOrderSlot в src/lib/repo.ts).
CREATE TABLE IF NOT EXISTS order_limits (
  client_key  TEXT NOT NULL,             -- tg:<id> или ip:<адрес>
  product_id  TEXT NOT NULL,
  created_at  BIGINT NOT NULL            -- unix ms, окно задаётся в коде
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_order_limits_client ON order_limits(client_key, created_at);

COMMIT;

-- ============================================================================
--  ПРОВЕРКА (после COMMIT отдельными запросами):
--  SELECT count(*) FROM information_schema.tables WHERE table_schema='public'; -- ожидается: 4
--  SELECT count(*) FROM products;   -- после сидирования: 17
-- ============================================================================
