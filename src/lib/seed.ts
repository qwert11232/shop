import { getDb } from "./db";
import { SEED_CATEGORIES, SEED_PRODUCTS } from "./catalog-seed";

/**
 * Наполнение каталога стартовыми данными. Идемпотентно: повторный вызов
 * не создаёт дублей (сверка по названию категории и товара).
 * Возвращает, что реально добавлено — это попадает в лог, а не в угадывание.
 */
export type SeedResult = { categories: number; products: number; driver: string };

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function seedCatalog(): Promise<SeedResult> {
  const db = await getDb();
  const catIds: Record<string, string> = {};
  let newCategories = 0;

  for (const [i, c] of SEED_CATEGORIES.entries()) {
    const existing = await db.get<{ id: string }>("SELECT id FROM categories WHERE name = ?", [c.name]);
    if (existing) {
      catIds[c.name] = existing.id;
      continue;
    }
    const id = uid();
    await db.run("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", [
      id,
      c.name,
      "",
      i,
    ]);
    catIds[c.name] = id;
    newCategories += 1;
  }

  let newProducts = 0;
  for (const p of SEED_PRODUCTS) {
    const exists = await db.get<{ id: string }>("SELECT id FROM products WHERE title = ?", [p.title]);
    if (exists) continue;
    await db.run(
      "INSERT INTO products (id, title, description, price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?)",
      [uid(), p.title, p.desc, Math.round(p.priceRub * 100), p.photo, catIds[p.category]],
    );
    newProducts += 1;
  }

  return { categories: newCategories, products: newProducts, driver: db.dialect };
}

/**
 * Наполнение при первом запросе: включается `AUTO_SEED=1` (по умолчанию на Vercel).
 * Нужно потому, что на деплое нет ни CLI, ни локального SQLite-файла: без этого
 * каталог остаётся пустым, хотя товары в коде есть.
 */
export async function seedIfEnabled(): Promise<void> {
  const enabled =
    process.env.AUTO_SEED === "1" || (process.env.AUTO_SEED !== "0" && Boolean(process.env.VERCEL));
  if (!enabled) return;
  const result = await seedCatalog();
  if (result.products > 0 || result.categories > 0) {
    console.log(
      `[seed] автонаполнение (${result.driver}): категорий +${result.categories}, товаров +${result.products}`,
    );
  }
}
