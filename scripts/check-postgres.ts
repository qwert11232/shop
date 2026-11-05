/**
 * Проверка PostgreSQL-диалекта без внешней БД: поднимаем pglite (PostgreSQL в WASM),
 * отдаём его в createPostgresDb как обычный пул и гоняем реальные сценарии.
 *
 * Запуск: npm run db:check:pg
 * Это не юнит-тест ради покрытия, а способ убедиться, что SQL из repo.ts валиден
 * для PostgreSQL: плейсхолдеры, boolean-литералы, имена колонок, типы.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "fs/promises";
import path from "path";
import { createPostgresDb } from "../src/lib/db-postgres";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`[check:pg] FAIL — ${message}`);
    process.exit(1);
  }
  console.log(`[check:pg] ok — ${message}`);
}

async function main() {
  const pg = new PGlite();
  // Тот же db-setup.sql, что применяется на managed-базе.
  const setupSql = await readFile(path.join(process.cwd(), "db-setup.sql"), "utf8");
  await pg.exec(setupSql);

  const db = createPostgresDb("postgres://local/check", {
    query: async (text: string, values?: unknown[]) => {
      const res = await pg.query(text, values);
      return { rows: res.rows };
    },
  });

  assert(db.dialect === "postgres", "диалект определён как postgres");

  await db.run("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", [
    "c1", "Смартфоны", "📱", 0,
  ]);
  await db.run(
    "INSERT INTO products (id, title, description, price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?)",
    ["p1", "iPhone 16 Pro", "тест", 8999000, "/products/iphone-16-pro.jpg", "c1"],
  );

  const active = await db.all<{ id: string }>("SELECT * FROM categories WHERE is_active = TRUE ORDER BY sort_order ASC");
  assert(active.length === 1, "активные категории читаются (boolean-литерал TRUE)");

  const tree = await db.get<{ productcount: number | string }>(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS productcount
     FROM categories c ORDER BY c.sort_order ASC, c.created_at ASC`,
  );
  assert(Number(tree?.productcount) === 1, "подзапрос со счётчиком товаров корректен на PG");

  await db.run("INSERT INTO orders (id, comment, product_id) VALUES (?, ?, ?)", ["o1", "проверка", "p1"]);
  const joined = await db.all<{ producttitle: string; productprice: number | string }>(
    `SELECT o.*, p.title AS producttitle, p.price AS productprice
     FROM orders o JOIN products p ON p.id = o.product_id ORDER BY o.created_at DESC LIMIT 100`,
  );
  assert(joined.length === 1 && joined[0].producttitle === "iPhone 16 Pro", "JOIN заявок и товаров работает");

  const order = await db.get<{ created_at: Date | string; is_active?: boolean }>("SELECT * FROM orders WHERE id = ?", ["o1"]);
  assert(order !== undefined, "get по id возвращает строку");
  assert(order?.created_at instanceof Date, "created_at приходит как Date (не строка) — приведение в repo.ts обязательно");

  await db.run("DELETE FROM order_limits WHERE created_at < ?", [0]);
  await db.run("INSERT INTO order_limits (client_key, product_id, created_at) VALUES (?, ?, ?)", ["tg:1", "p1", 1000]);
  const gate = await db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM order_limits WHERE client_key = ? AND created_at >= ?", ["tg:1", 0]);
  assert(Number(gate?.c) === 1, "таблица лимитов заявок есть в схеме и доступна по SQL");

  const inserted = await db.get<{ m: number | string | null }>("SELECT MAX(sort_order) AS m FROM categories");
  assert(Number(inserted?.m) === 0, "MAX() по пустой выборке не ломает приведение");

  await checkEmptyDatabaseBootstrap();

  console.log("[check:pg] PASS — SQL-слой совместим с PostgreSQL");
}

/**
 * Главный сценарий деплоя: база пустая, приложение поднимает схему и само
 * наполняет каталог. Ровно это выполняется на Vercel при первом запросе.
 */
async function checkEmptyDatabaseBootstrap() {
  const { __setDbForCheck } = await import("../src/lib/db");
  const { ensurePostgresSchema, POSTGRES_SCHEMA_SQL, POSTGRES_MIGRATIONS_SQL } = await import(
    "../src/lib/db-postgres-schema"
  );
  const { seedCatalog } = await import("../src/lib/seed");
  const { listCatalog } = await import("../src/lib/repo");

  const pg = new PGlite();
  const db = createPostgresDb("postgres://local/bootstrap", {
    query: async (text: string, values?: unknown[]) => {
      const res = await pg.query(text, values);
      return { rows: res.rows };
    },
    exec: async (sql: string) => {
      await pg.exec(sql);
    },
  });
  __setDbForCheck(db);

  await ensurePostgresSchema(db);
  assert(true, "схема накатывается на пустую базу (DDL из db-setup.sql)");

  const seeded = await seedCatalog();
  // Товары делятся на основную линейку (17) и аксессуары для блока «с этим покупают».
  assert(seeded.products === 21 && seeded.categories === 6, "сид создал 6 категорий и 21 товар");

  const again = await seedCatalog();
  assert(again.products === 0 && again.categories === 0, "повторный сид идемпотентен — дублей нет");

  const catalog = await listCatalog();
  assert(catalog.length === 6, "витрина видит 6 категорий");
  const total = catalog.reduce((n, c) => n + c.products.length, 0);
  assert(total === 21, "витрина видит 21 товар");
  assert(catalog.every((c) => c.products.length > 0), "нет пустых категорий");
  assert(catalog.every((c) => c.products.every((p) => p.price > 0)), "у всех товаров цена в копейках");
  assert(catalog.every((c) => c.products.every((p) => p.photoUrl.startsWith("/products/"))), "у всех товаров фото из public/products");
  assert(catalog.every((c) => c.products.every((p) => p.description.length > 20)), "у всех товаров описание заполнено");

  // schema-файл и миграционный файл не должны расходиться
  const setupSql = await readFile(path.join(process.cwd(), "db-setup.sql"), "utf8");
  const normalize = (sql: string) =>
    sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").replace(/BEGIN|COMMIT|;/gi, "").trim();
  assert(
    normalize(POSTGRES_SCHEMA_SQL + POSTGRES_MIGRATIONS_SQL) === normalize(setupSql.split("COMMIT")[0]),
    "POSTGRES_SCHEMA_SQL + миграции совпадают с db-setup.sql по операторам",
  );

  __setDbForCheck(null);
}

main().catch((err) => {
  console.error("[check:pg] ошибка:", err);
  process.exit(1);
});
