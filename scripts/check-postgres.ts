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
  await checkDatabaseUrlParsing();
  await checkPhotoMigration();

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
  // 17 позиций с собственными фото: аксессуары, у которых фотографии были
  // одолжены у других товаров, из каталога удалены.
  assert(seeded.products === 17 && seeded.categories === 6, "сид создал 6 категорий и 17 товаров");

  const again = await seedCatalog();
  assert(again.products === 0 && again.categories === 0, "повторный сид идемпотентен — дублей нет");

  const catalog = await listCatalog();
  assert(catalog.length === 6, "витрина видит 6 категорий");
  const total = catalog.reduce((n, c) => n + c.products.length, 0);
  assert(total === 17, "витрина видит 17 товаров");
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

/**
 * Строка подключения — самая частая причина «на деплое пусто». Проверяем,
 * что разбор находит именно ту ошибку, которую видит человек: без хоста,
 * без пароля, с `&amp;` из чата и с паролем, где есть «@».
 */
async function checkDatabaseUrlParsing(): Promise<void> {
  const { analyzeDatabaseUrl, sanitizeConnectionString } = await import("../src/lib/db-url");

  const broken = analyzeDatabaseUrl(
    "postgresql://neondb_owner:////////////////////////////neondb?sslmode=require&amp;channel_binding=require",
  );
  assert(broken.dialect === "postgres", "диалект определяется по префиксу");
  assert(broken.problems.length > 0, "неполная строка Neon распознаётся как ошибка, а не как рабочий конфиг");
  assert(
    broken.problems.some((p) => p.includes("хост")),
    "в подсказке сказано про хост, а не «ENOTFOUND»",
  );

  const good = analyzeDatabaseUrl(
    "postgresql://neondb_owner:npg_secret@ep-cool-1234.eu-central-1.aws.neon.tech/neondb?sslmode=require&amp;channel_binding=require",
  );
  assert(good.problems.length === 0, "полная строка Neon проходит без замечаний по существу");
  assert(good.host.includes("neon.tech") && good.database === "neondb", "хост и база разобраны");
  assert(good.hasPassword, "наличие пароля видно без раскрытия значения");
  assert(!JSON.stringify(good).includes("npg_secret"), "пароль не попадает в отчёт для /api/health");

  const noPassword = analyzeDatabaseUrl("postgresql://neondb_owner@ep-1.eu-central-1.aws.neon.tech/neondb");
  assert(noPassword.problems.some((p) => p.includes("парол")), "отсутствие пароля объясняется словами");

  const oneAt = analyzeDatabaseUrl("postgresql://u:p@ss@ep-1.aws.neon.tech/neondb?sslmode=require");
  assert(oneAt.warnings.some((w) => w.includes("%40")), "пароль с «@» подсказывает про экранирование");

  const sanitized = sanitizeConnectionString(
    "postgresql://u:p@ep-1.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  );
  assert(!sanitized.includes("channel_binding"), "channel_binding из шаблона Neon вырезается для драйвера");
  assert(sanitized.includes("sslmode=require"), "sslmode при этом сохраняется");

  assert(analyzeDatabaseUrl("file:./dev.db").dialect === "sqlite", "SQLite-путь не считается ошибкой");
}

/**
 * Переезд фото в WebP на базе, созданной прошлым деплоем.
 *
 * Сборка сжимает картинки в `public/products/*.webp` и удаляет исходные PNG/JPEG.
 * В базе при этом остаются старые пути — без миграции витрина показала бы битые
 * фото. Проверяем на настоящем PostgreSQL: существующий товар получает новый
 * путь, а свежий сид сразу пишет WebP.
 */
async function checkPhotoMigration(): Promise<void> {
  const pg = new PGlite();
  await pg.exec(await readFile(path.join(process.cwd(), "db-setup.sql"), "utf8"));
  const db = createPostgresDb("postgres://local/migrate", {
    query: async (text: string, values?: unknown[]) => ({ rows: (await pg.query(text, values)).rows }),
  });
  const { __setDbForCheck } = await import("../src/lib/db");
  __setDbForCheck(db);

  // Товар из прошлого деплоя: старое название из сида и путь к PNG.
  await db.run("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", ["c-old", "Смартфоны", "", 0]);
  await db.run(
    "INSERT INTO products (id, title, description, price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?)",
    ["p-old", "iPhone 16 Pro 256 ГБ", "старое описание", 349000, "/products/iphone-16-pro.jpg", "c-old"],
  );
  await db.run("INSERT INTO product_media (id, product_id, kind, url, sort_order) VALUES (?, ?, ?, ?, ?)", [
    "m-old", "p-old", "image", "/products/iphone-16-pro.jpg", 1,
  ]);

  const { seedCatalog } = await import("../src/lib/seed");
  const result = await seedCatalog();
  assert(result.backfilled >= 1, "сид доводит существующий товар прошлого деплоя");

  const migrated = await db.get<{ photo_url: string }>("SELECT photo_url FROM products WHERE id = 'p-old'");
  assert(migrated?.photo_url === "/products/iphone-16-pro.webp", "старый путь .jpg у существующего товара переведён в .webp");

  const media = await db.all<{ url: string }>("SELECT url FROM product_media WHERE product_id = 'p-old' ORDER BY sort_order");
  assert(media.every((m) => m.url.endsWith(".webp")), "галерея существующего товара тоже переведена в .webp");

  const price = await db.get<{ price: number | string }>("SELECT price FROM products WHERE id = 'p-old'");
  assert(Number(price?.price) === 349000, "цену, изменённую владельцем, сид не трогает");
  const desc = await db.get<{ description: string }>("SELECT description FROM products WHERE id = 'p-old'");
  assert(desc?.description === "старое описание", "описание владельца сид не переписывает");

  // Аксессуар с фотографией чужого товара убирается с витрины при первом же сиде.
  await db.run("INSERT INTO products (id, title, description, price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?)", [
    "p-bad", "Чехол силиконовый MagSafe", "мягкий силикон", 499000, "/products/iphone-16-pro.webp", "c-old",
  ]);
  const cleaned = await seedCatalog();
  assert(cleaned.cleanup.deleted.includes("Чехол силиконовый MagSafe"), "демо-аксессуар с чужим фото удалён");
  const gone = await db.get<{ id: string }>("SELECT id FROM products WHERE id = 'p-bad'");
  assert(gone === undefined, "удалённый аксессуар не остаётся в базе");

  const stale = await db.all<{ id: string }>(
    "SELECT id FROM products WHERE photo_url LIKE '%.jpg' OR photo_url LIKE '%.png'",
  );
  assert(stale.length === 0, "после сида не остаётся товаров со старыми путями фото");

  const external = await db.get<{ id: string }>("SELECT id FROM products LIMIT 1");
  assert(Boolean(external), "товары в базе есть");
  __setDbForCheck(null);
}
