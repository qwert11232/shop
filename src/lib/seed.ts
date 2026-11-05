import { getDb } from "./db";
import { SEED_CATEGORIES, SEED_PRODUCTS, type SeedProduct } from "./catalog-seed";

/**
 * Наполнение каталога стартовыми данными. Идемпотентно: повторный вызов
 * не создаёт дублей (сверка по названию категории и товара).
 * Возвращает, что реально добавлено — это попадает в лог, а не в угадывание.
 */
export type SeedResult = {
  categories: number;
  products: number;
  variants: number;
  specs: number;
  crossSell: number;
  /** Сколько уже существующих товаров удалось дозаполнить (бренд, детали). */
  backfilled: number;
  driver: string;
};

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
  let newVariants = 0;
  let newSpecs = 0;
  let backfilled = 0;
  const productIds: Record<string, string> = {};

  for (const p of SEED_PRODUCTS) {
    const exists = await db.get<{ id: string; brand: string | null }>(
      "SELECT id, brand FROM products WHERE title = ?",
      [p.title],
    );
    if (exists) {
      productIds[p.title] = exists.id;
      // Товар уже есть (прошлый деплой): доводим то, что появилось вместе с новой
      // витриной — бренд, варианты, характеристики, галерею. Цену и фото не трогаем:
      // их мог изменить владелец через бота.
      let touched = false;
      if (!exists.brand && p.brand) {
        await db.run("UPDATE products SET brand = ? WHERE id = ?", [p.brand, exists.id]);
        touched = true;
      }
      const added = await seedDetails(exists.id, p);
      if (added.variants > 0 || added.specs > 0) {
        newVariants += added.variants;
        newSpecs += added.specs;
        touched = true;
      }
      if (touched) backfilled += 1;
      continue;
    }
    const id = uid();
    await db.run(
      `INSERT INTO products (id, title, description, price, photo_url, category_id, brand)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, p.title, p.desc, Math.round(p.priceRub * 100), p.photo, catIds[p.category], p.brand],
    );
    productIds[p.title] = id;
    newProducts += 1;

    const details = await seedDetails(id, p);
    newVariants += details.variants;
    newSpecs += details.specs;
  }

  // Cross-sell: связь «товар → аксессуар» через таблицу тегов, чтобы не заводить
  // отдельную сущность ради одного отношения.
  let crossSell = 0;
  for (const p of SEED_PRODUCTS) {
    const id = productIds[p.title];
    if (!id || !p.crossSell?.length) continue;
    for (const [index, title] of p.crossSell.entries()) {
      const target = productIds[title];
      if (!target || target === id) continue;
      const linked = await db.get<{ product_id: string }>(
        "SELECT product_id FROM product_specs WHERE product_id = ? AND name = ?",
        [id, `cross:${target}`],
      );
      if (linked) continue;
      await db.run(
        "INSERT INTO product_specs (product_id, group_name, name, value, unit, numeric, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, "cross-sell", `cross:${target}`, title, "", null, index],
      );
      crossSell += 1;
    }
  }

  return {
    categories: newCategories,
    products: newProducts,
    variants: newVariants,
    specs: newSpecs,
    crossSell,
    backfilled,
    driver: db.dialect,
  };
}

/**
 * Варианты, характеристики и галерея одного товара.
 *
 * Сид — это синхронизация, а не только вставка: демо-каталог живёт в коде, и
 * правка характеристики должна доезжать до базы, созданной прошлым деплоем.
 * Поэтому варианты и спеки сопоставляются по стабильному ключу (`kind+label`,
 * `group+name`) и обновляются на месте — id вариантов не меняются, а значит
 * корзины клиентов не теряют ссылки. Галерея только досоздаётся: кадры,
 * загруженные владельцем, сид не перезаписывает.
 */
async function seedDetails(
  productId: string,
  p: SeedProduct,
): Promise<{ variants: number; specs: number }> {
  const db = await getDb();
  let variants = 0;
  let specs = 0;

  for (const [index, v] of (p.variants ?? []).entries()) {
    const extra = Math.round((v.extraRub ?? 0) * 100);
    const existing = await db.get<{ id: string; extra: number | string }>(
      "SELECT id, extra FROM product_variants WHERE product_id = ? AND kind = ? AND label = ?",
      [productId, v.kind, v.label],
    );
    if (existing) {
      if (Number(existing.extra) !== extra) {
        await db.run("UPDATE product_variants SET extra = ?, sort_order = ? WHERE id = ?", [
          extra,
          index,
          existing.id,
        ]);
      }
      continue;
    }
    await db.run(
      `INSERT INTO product_variants (id, product_id, label, kind, extra, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uid(), productId, v.label, v.kind, extra, index],
    );
    variants += 1;
  }

  for (const [index, spec] of (p.specs ?? []).entries()) {
    const unit = spec.unit ?? "";
    const numeric = spec.numeric ?? null;
    const existing = await db.get<{ product_id: string; value: string; unit: string; numeric: number | null }>(
      `SELECT product_id, value, unit, numeric FROM product_specs
       WHERE product_id = ? AND group_name = ? AND name = ?`,
      [productId, spec.group, spec.name],
    );
    if (existing) {
      const same =
        existing.value === spec.value &&
        (existing.unit ?? "") === unit &&
        (existing.numeric === null ? null : Number(existing.numeric)) === numeric;
      if (!same) {
        await db.run(
          "UPDATE product_specs SET value = ?, unit = ?, numeric = ?, sort_order = ? WHERE product_id = ? AND group_name = ? AND name = ?",
          [spec.value, unit, numeric, index, productId, spec.group, spec.name],
        );
      }
      continue;
    }
    await db.run(
      `INSERT INTO product_specs (product_id, group_name, name, value, unit, numeric, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productId, spec.group, spec.name, spec.value, unit, numeric, index],
    );
    specs += 1;
  }

  const mediaRow = await db.get<{ c: number | string }>(
    "SELECT COUNT(*) AS c FROM product_media WHERE product_id = ?",
    [productId],
  );
  if (Number(mediaRow?.c ?? 0) === 0) {
    const gallery = [p.photo, ...(p.gallery ?? [])];
    for (const [index, url] of gallery.entries()) {
      await db.run("INSERT INTO product_media (id, product_id, kind, url, sort_order) VALUES (?, ?, ?, ?, ?)", [
        uid(),
        productId,
        "image",
        url,
        index,
      ]);
    }
  }

  return { variants, specs };
}

/**
 * Наполнение при первом запросе: включено по умолчанию, `AUTO_SEED=0` отключает.
 * Нужно потому, что товары живут в базе, а не в коде: без этого новый деплой
 * показывал бы старый каталог без брендов, вариантов и характеристик.
 */
export async function seedIfEnabled(): Promise<void> {
  // Сид дешёвый и идемпотентный (по набору SQL-проверок на запрос), а витрина без
  // брендов и характеристик нерабочая. Поэтому наполняем по умолчанию везде,
  // включая локальный запуск; AUTO_SEED=0 отключает принудительно.
  const enabled = process.env.AUTO_SEED !== "0";
  if (!enabled) return;
  const result = await seedCatalog();
  if (result.products > 0 || result.categories > 0 || result.backfilled > 0) {
    console.log(
      `[seed] автонаполнение (${result.driver}): категорий +${result.categories}, товаров +${result.products}, ` +
        `дозаполнено ${result.backfilled}, вариантов +${result.variants}, связей +${result.crossSell}`,
    );
  }
}
