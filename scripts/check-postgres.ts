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
  await checkSettingsAndSearch();
  await checkDiscounts();
  await checkOrderFlow();
  await checkCartMigration();

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

/**
 * Настройки магазина и поиск заказов на настоящем PostgreSQL.
 *
 * Почему отдельно: `searchOrders` использует `LIKE ... ESCAPE`, а таблица
 * `settings` появилась в этом же коммите. На SQLite всё работает, но DDL и
 * ESCAPE-синтаксис нужно проверить на том движке, который стоит на бою.
 */
/**
 * Скидка на PostgreSQL: колонка old_price есть и в DDL, и в миграции,
 * а фильтр «только со скидкой» работает на том же SQL-слое.
 */
async function checkDiscounts(): Promise<void> {
  const { POSTGRES_SCHEMA_SQL } = await import("../src/lib/db-postgres-schema");
  const { __setDbForCheck } = await import("../src/lib/db");
  const repo = await import("../src/lib/repo");
  const { applyFilters } = await import("../src/lib/catalog");
  const { hasDiscount, discountPercent } = await import("../src/lib/price");

  // Берём db-setup.sql — тот же файл, что применяется на managed-базе, —
  // и проверяем, что колонка скидки доехала и туда, и в код-схему.
  const pg = new PGlite();
  await pg.exec(await readFile(path.join(process.cwd(), "db-setup.sql"), "utf8"));
  assert(
    POSTGRES_SCHEMA_SQL.includes("old_price") === true,
    "old_price объявлен и в код-схеме, и в db-setup.sql",
  );
  assert(
    (await tableHasColumn(pg, "products", "old_price")) === true,
    "колонка old_price существует после установки схемы",
  );
  const db = createPostgresDb("postgres://local/discount", {
    query: async (text: string, values?: unknown[]) => {
      const res = await pg.query(text, values);
      return { rows: res.rows };
    },
  });
  __setDbForCheck(db);

  const category = await repo.createCategory({ name: "Тест скидок", icon: "" });
  const sale = await repo.createProduct({
    title: "Товар со скидкой",
    priceKopecks: 900000,
    oldPriceKopecks: 1000000,
    categoryId: category.id,
  });
  const plain = await repo.createProduct({
    title: "Товар без скидки",
    priceKopecks: 500000,
    categoryId: category.id,
  });

  assert(sale.oldPrice === 1000000, "старая цена сохраняется в PostgreSQL");
  assert(plain.oldPrice === 0, "без скидки old_price = 0, а не NULL");
  assert(hasDiscount(sale) && discountPercent(sale) === 10, "скидка считается по данным из PostgreSQL");
  assert(!hasDiscount(plain), "товар без старой цены скидкой не считается");

  const onlyDiscounted = applyFilters(
    [{ ...sale, brand: "" }, { ...plain, brand: "" }],
    { onlyDiscounted: true },
  );
  assert(
    onlyDiscounted.length === 1 && onlyDiscounted[0].id === sale.id,
    "фильтр «только со скидкой» отбирает один товар",
  );

  const cleared = await repo.updateProduct(sale.id, { oldPriceKopecks: 0 });
  assert(cleared?.oldPrice === 0, "скидка снимается и в PostgreSQL");
  assert(!hasDiscount(cleared!), "после снятия товар обычный");
  __setDbForCheck(null);
}

/** Есть ли колонка: DDL в коде и ALTER-миграции должны совпадать. */
async function tableHasColumn(pg: PGlite, table: string, column: string): Promise<boolean> {
  const res = await pg.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return res.rows.length > 0;
}

async function checkSettingsAndSearch(): Promise<void> {
  const pg = new PGlite();
  await pg.exec(await readFile(path.join(process.cwd(), "db-setup.sql"), "utf8"));
  const db = createPostgresDb("postgres://local/settings", {
    query: async (text: string, values?: unknown[]) => ({ rows: (await pg.query(text, values)).rows }),
  });
  const { __setDbForCheck } = await import("../src/lib/db");
  __setDbForCheck(db);

  const settings = await import("../src/lib/settings");
  await settings.setSetting("payment_details", "СБП +7 900 111-22-33");
  await settings.setSetting("payment_link", "https://pay.example.com/o/1");
  const saved = await settings.getSettings();
  assert(saved.payment_details === "СБП +7 900 111-22-33", "реквизиты читаются из PostgreSQL");
  await settings.setSetting("payment_details", "");
  assert((await settings.getSettings()).payment_details === "", "пустая строка стирает настройку и на PostgreSQL");
  await settings.setSetting("payment_note", "Чек в чат");
  assert((await settings.getSettings()).payment_note === "Чек в чат", "повторная запись обновляет строку, а не падает");

  // Поиск: точное совпадение, хвост номера, телефон, экранирование.
  await db.run("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", ["c1", "Тест", "", 0]);
  await db.run("INSERT INTO products (id, title, description, price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?)", [
    "p1", "Товар", "описание для теста", 100000, "/products/ps5.webp", "c1",
  ]);
  await db.run(
    "INSERT INTO orders (id, comment, tg_user_id, first_name, username, contact_phone, product_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["ord-abc12345", "", "1", "Иван", "", "+79990001122", "p1"],
  );
  const { searchOrders, orderQueueCounts } = await import("../src/lib/repo");
  assert((await searchOrders("abc12345")).length === 1, "поиск по хвосту номера работает на PostgreSQL");
  assert((await searchOrders("Иван")).length === 1, "поиск по имени работает на PostgreSQL");
  assert((await searchOrders("999000")).length === 1, "поиск по телефону работает на PostgreSQL");
  assert((await searchOrders("zzzz")).length === 0, "несуществующий запрос ничего не находит на PostgreSQL");
  assert((await searchOrders("100%")).length === 0, "процент в запросе не превращается в шаблон LIKE");
  assert((await searchOrders("_")).length === 0, "подчёркивание не совпадает с любым символом");

  await db.run("UPDATE orders SET delivery_status = 'confirmed' WHERE id = ?", ["ord-abc12345"]);
  const queues = await orderQueueCounts();
  assert(queues.awaitingPayment === 1, "очередь оплаты считается на PostgreSQL");
  __setDbForCheck(null);
}

/**
 * Вся механика заказа на PostgreSQL: корзина с вариантом и без, оформление,
 * позиции, бонусы, очистка корзины.
 *
 * Появилась после боевой ошибки: `PRIMARY KEY (tg_user_id, product_id, variant_id)`
 * в PostgreSQL делает variant_id NOT NULL (так работает стандарт), и товар без
 * варианта не добавлялся в корзину вовсе. На SQLite это не проявлялось —
 * там NULL в первичном ключе разрешён, поэтому проверка на SQLite молчала.
 */
async function checkOrderFlow(): Promise<void> {
  const { __setDbForCheck } = await import("../src/lib/db");
  const shop = await import("../src/lib/shop");
  const { POSTGRES_SCHEMA_SQL, POSTGRES_MIGRATIONS_SQL } = await import("../src/lib/db-postgres-schema");

  const pg = new PGlite();
  await pg.exec(POSTGRES_SCHEMA_SQL);
  await pg.exec(POSTGRES_MIGRATIONS_SQL);
  const db = createPostgresDb("postgres://local/orders", {
    query: async (text: string, values?: unknown[]) => {
      const res = await pg.query(text, values);
      return { rows: res.rows };
    },
  });
  __setDbForCheck(db);

  await db.run("INSERT INTO categories (id, name, icon) VALUES (?, ?, ?)", ["c1", "Смартфоны", ""]);
  // Товар без вариантов и товар с двумя вариантами — оба пути корзины.
  await db.run(
    "INSERT INTO products (id, title, description, price, old_price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["p-plain", "Товар без вариантов", "", 100000, 0, "/p1.webp", "c1"],
  );
  await db.run(
    "INSERT INTO products (id, title, description, price, old_price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["p-var", "Телефон с памятью", "", 9000000, 0, "/p2.webp", "c1"],
  );
  await db.run(
    "INSERT INTO product_variants (id, product_id, kind, label, extra, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    ["v-128", "p-var", "variant", "128 ГБ", -800000, 0],
  );
  await db.run(
    "INSERT INTO product_variants (id, product_id, kind, label, extra, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    ["v-512", "p-var", "variant", "512 ГБ", 1500000, 1],
  );

  // Главное: товар без варианта кладётся в корзину (в PG NULL в PK запрещён).
  const buyer = "900001";
  let cart = await shop.addToCart({ tgUserId: buyer, productId: "p-plain", quantity: 2 });
  assert(cart.lines.length === 1, "товар без вариантов добавляется в корзину на PostgreSQL");
  assert(cart.lines[0].variantId === null, "у строки без варианта variantId = null, а не заглушка");
  assert(cart.lines[0].lineTotal === 200000, "количество умножает цену");

  // Повторное добавление увеличивает количество, а не плодит строки.
  cart = await shop.addToCart({ tgUserId: buyer, productId: "p-plain", quantity: 1 });
  assert(cart.lines.length === 1 && cart.lines[0].quantity === 3, "повторное добавление увеличивает количество");

  // Товар с вариантом: надбавка входит в цену строки.
  cart = await shop.addToCart({ tgUserId: buyer, productId: "p-var", variantId: "v-128", quantity: 1 });
  const varLine = cart.lines.find((l) => l.variantId === "v-128");
  assert(varLine !== undefined, "товар с вариантом попадает в корзину отдельной строкой");
  assert(varLine!.unitPrice === 8200000, "цена строки = цена товара + надбавка варианта");
  assert(varLine!.variantLabel === "128 ГБ", "подпись варианта доходит до корзины");

  // Тот же товар в другом варианте — вторая строка, а не перезапись.
  cart = await shop.addToCart({ tgUserId: buyer, productId: "p-var", variantId: "v-512", quantity: 1 });
  assert(cart.lines.length === 3, "разные варианты одного товара — разные строки корзины");

  // Изменение количества и удаление строки без варианта.
  cart = await shop.setCartQuantity({ tgUserId: buyer, productId: "p-plain", variantId: null, quantity: 5 });
  assert(cart.lines.find((l) => l.productId === "p-plain")!.quantity === 5, "количество строки без варианта меняется");
  cart = await shop.setCartQuantity({ tgUserId: buyer, productId: "p-var", variantId: "v-512", quantity: 0 });
  assert(!cart.lines.some((l) => l.variantId === "v-512"), "нулевое количество удаляет строку");

  // Чужой вариант не должен попасть в свою корзину.
  let rejected = false;
  await shop.addToCart({ tgUserId: buyer, productId: "p-plain", variantId: "v-128", quantity: 1 }).catch(() => {
    rejected = true;
  });
  assert(rejected, "вариант от другого товара отклоняется");

  // Оформление: сумма, позиции, бонусы.
  const before = cart.total;
  const order = await shop.createPurchaseOrder({
    tgUserId: buyer,
    contactName: "Иван",
    contactPhone: "+7 900 000-00-00",
    total: before,
    items: cart.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity })),
  });
  assert(order.total === before, "сумма заказа равна сумме корзины");

  const items = await shop.listOrderItems(order.id);
  assert(items.length === 2, "в заказ попали обе позиции");
  assert(
    items.some((i) => i.variant === "128 ГБ") && items.some((i) => i.variant === ""),
    "вариант сохранён в позиции, у товара без варианта — пустая строка",
  );
  assert(
    items.every((i) => i.price > 0 && i.quantity > 0),
    "у каждой позиции есть цена и количество",
  );

  const mine = await shop.listMyOrders(buyer);
  assert(mine.some((o) => o.id === order.id), "заказ виден в «Моих заказах»");

  const customer = await shop.getCustomer(buyer);
  assert((customer?.bonusBalance ?? 0) > 0, "кешбэк начислен покупателю");

  // Статусы: заказ двигается по цепочке и это видно в списке.
  await shop.setDeliveryStatus(order.id, "shipped");
  const shipped = (await shop.listMyOrders(buyer)).find((o) => o.id === order.id)!;
  assert(shipped !== undefined, "смена статуса доставки не теряет заказ");

  await shop.clearCart(buyer);
  const empty = await shop.getCart(buyer);
  assert(empty.lines.length === 0 && empty.savings === 0, "после оформления корзина пуста");

  __setDbForCheck(null);
}

/**
 * Миграция корзины: база, созданная старым DDL (variant_id в первичном ключе),
 * должна открыться и принять товар без варианта после прогона миграций.
 * Без этого фикс работал бы только на новых установках.
 */
async function checkCartMigration(): Promise<void> {
  const { POSTGRES_SCHEMA_SQL, POSTGRES_MIGRATIONS_SQL } = await import("../src/lib/db-postgres-schema");

  const pg = new PGlite();
  // Старая схема — как она выглядела до исправления.
  await pg.exec(`
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE products (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL, photo_url TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      category_id TEXT NOT NULL REFERENCES categories(id));
    CREATE TABLE cart_items (
      tg_user_id TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      variant_id TEXT,
      quantity   INTEGER NOT NULL DEFAULT 1,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (tg_user_id, product_id, variant_id)
    );
    INSERT INTO categories (id, name) VALUES ('c1', 'Тест');
    INSERT INTO products (id, title, price, photo_url, category_id) VALUES ('p1', 'Товар', 1000, '/p.webp', 'c1');
    INSERT INTO cart_items (tg_user_id, product_id, variant_id, quantity, updated_at)
      VALUES ('u1', 'p1', 'v1', 2, 1);
  `);

  // До миграции старый ключ действительно не пускает NULL.
  let failedBefore = false;
  await pg.query(
    "INSERT INTO cart_items (tg_user_id, product_id, variant_id, quantity, updated_at) VALUES ($1, $2, $3, $4, $5)",
    ["u1", "p1", null, 1, 2],
  ).catch(() => {
    failedBefore = true;
  });
  assert(failedBefore, "старая схема воспроизводит ошибку: NULL в variant_id запрещён первичным ключом");

  await pg.exec(POSTGRES_SCHEMA_SQL);
  await pg.exec(POSTGRES_MIGRATIONS_SQL);

  const db = createPostgresDb("postgres://local/migration", {
    query: async (text: string, values?: unknown[]) => {
      const res = await pg.query(text, values);
      return { rows: res.rows };
    },
    exec: async (sql: string) => {
      await pg.exec(sql);
    },
  });

  // Старая строка сохранилась и получила id.
  // Настоящая миграция приложения: та же функция, что зовёт деплой при старте.
  const { ensurePostgresSchema } = await import("../src/lib/db-postgres-schema");
  await ensurePostgresSchema(db);

  const kept = await db.all<{ id: string; quantity: number | string; variant_id: string | null }>(
    "SELECT id, quantity, variant_id FROM cart_items",
  );
  assert(kept.length === 1 && kept[0].id !== null, "существующая строка корзины пережила миграцию и получила id");
  assert(Number(kept[0].quantity) === 2, "количество в старой строке не потерялось");

  await db.run(
    "INSERT INTO cart_items (id, tg_user_id, product_id, variant_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["ci-2", "u1", "p1", null, 1, 3],
  );
  assert(true, "после миграции товар без варианта вставляется");

  // Повторный прогон миграций безопасен, иначе деплой падал бы на каждом старте.
  await pg.exec(POSTGRES_SCHEMA_SQL);
  await pg.exec(POSTGRES_MIGRATIONS_SQL);
  const after = await db.all<{ id: string }>("SELECT id FROM cart_items");
  assert(after.length === 2, "повторная миграция ничего не дублирует и не теряет");
}
