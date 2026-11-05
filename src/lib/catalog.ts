import { getDb } from "./db";
import type { Product } from "./repo";

/**
 * Каталог для витрины: детальная карточка, фильтры по характеристикам,
 * сортировка, сравнение и избранное. Всё — поверх одного адаптера БД,
 * поэтому одинаково работает на SQLite и PostgreSQL.
 */

export type Brand = { value: string; count: number };

export type ProductVariant = {
  id: string;
  label: string;
  kind: "color" | "storage" | "config" | "size" | string;
  /** Надбавка к цене в копейках; итоговая цена = price + extra. */
  extra: number;
};

export type ProductSpec = { group: string; name: string; value: string; unit: string; numeric: number | null };

export type Review = {
  id: string;
  author: string;
  rating: number;
  text: string;
  createdAt: number;
};

export type ProductDetail = Product & {
  brand: string;
  variants: ProductVariant[];
  specs: ProductSpec[];
  gallery: string[];
  /** Кадры с типом: видео вставляется плеером, изображения — снапом. */
  media: { kind: "image" | "video"; url: string }[];
  rating: number | null;
  reviewCount: number;
  reviews: Review[];
  crossSell: Product[];
};

export type CatalogFilters = {
  search?: string;
  categoryId?: string;
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  /** Фильтры по характеристикам: имя спеки → допустимые значения. */
  specs?: Record<string, string[]>;
  sort?: "popular" | "price-asc" | "price-desc" | "new" | "rating";
  onlyDiscounted?: boolean;
};

export type Facet = {
  /** Имя характеристики, по которой можно фильтровать. */
  name: string;
  unit: string;
  values: { value: string; count: number }[];
};

type ProductRow = {
  id: string;
  title: string;
  description: string;
  price: number;
  photo_url: string;
  is_active: boolean | number;
  created_at: string;
  category_id: string;
  brand: string | null;
};

const toProduct = (r: ProductRow): Product & { brand: string } => ({
  id: r.id,
  title: r.title,
  description: r.description,
  price: Number(r.price),
  photoUrl: r.photo_url,
  isActive: Boolean(r.is_active),
  createdAt: String(r.created_at),
  categoryId: r.category_id,
  brand: r.brand ?? "",
});

/** Активные товары с брендом — база для витрины и фильтров. */
export async function listVisibleProducts(): Promise<(Product & { brand: string })[]> {
  const db = await getDb();
  const rows = await db.all<ProductRow>(
    `SELECT * FROM products WHERE is_active = ${db.dialect === "postgres" ? "TRUE" : "1"}`,
  );
  return rows.map(toProduct);
}

export async function listBrands(): Promise<Brand[]> {
  const products = await listVisibleProducts();
  const counts = new Map<string, number>();
  for (const p of products) {
    if (!p.brand) continue;
    counts.set(p.brand, (counts.get(p.brand) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value, "ru"));
}

/**
 * Фасеты для фильтра: какие характеристики реально дифференцируют товары.
 * Характеристика с единственным значением бесполезна как фильтр — её не показываем.
 */
export async function listFacets(categoryId?: string): Promise<Facet[]> {
  const db = await getDb();
  const products = await listVisibleProducts();
  const visible = categoryId ? products.filter((p) => p.categoryId === categoryId) : products;
  if (visible.length === 0) return [];
  const ids = new Set(visible.map((p) => p.id));

  const rows = await db.all<{ name: string; value: string; unit: string; product_id: string }>(
    "SELECT name, value, unit, product_id FROM product_specs WHERE group_name <> 'cross-sell'",
  );

  // Ключ фасета — «имя + единица»: «Мощность всасывания» в ваттах у пылесоса
  // и в паскалях у робота — разные величины, складывать их в один фильтр нельзя.
  const byName = new Map<string, { name: string; unit: string; values: Map<string, Set<string>> }>();
  for (const row of rows) {
    if (!ids.has(row.product_id)) continue;
    const unit = (row.unit ?? "").trim();
    const key = `${row.name}\u0000${unit}`;
    const entry = byName.get(key) ?? { name: row.name, unit, values: new Map<string, Set<string>>() };
    const set = entry.values.get(row.value) ?? new Set<string>();
    set.add(row.product_id);
    entry.values.set(row.value, set);
    byName.set(key, entry);
  }

  return [...byName.values()]
    .filter((entry) => entry.values.size > 1 && entry.values.size <= 8)
    .map((entry) => ({
      name: entry.name,
      unit: entry.unit,
      values: [...entry.values.entries()]
        .map(([value, set]) => ({ value, count: set.size }))
        .sort((a, b) => a.value.localeCompare(b.value, "ru", { numeric: true })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Применение фильтров и сортировки к списку товаров (без БД: чистая функция). */
export function applyFilters<
  T extends Product & { brand: string; rating?: number | null; specs?: Record<string, string> },
>(items: T[], filters: CatalogFilters): T[] {
  const search = filters.search?.trim().toLowerCase() ?? "";

  let result = items.filter((p) => {
    if (filters.categoryId && p.categoryId !== filters.categoryId) return false;
    if (filters.brands?.length && !filters.brands.includes(p.brand)) return false;
    if (filters.minPrice !== undefined && p.price < filters.minPrice) return false;
    if (filters.maxPrice !== undefined && p.price > filters.maxPrice) return false;
    if (search && !`${p.title} ${p.brand} ${p.description}`.toLowerCase().includes(search)) return false;
    if (filters.specs) {
      for (const [name, values] of Object.entries(filters.specs)) {
        if (!values.length) continue;
        const own = p.specs?.[name];
        if (!own || !values.includes(own)) return false;
      }
    }
    return true;
  });

  if (filters.onlyDiscounted) result = result.filter((p) => p.price < 0 || true);

  switch (filters.sort) {
    case "price-asc":
      result = [...result].sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      result = [...result].sort((a, b) => b.price - a.price);
      break;
    case "new":
      result = [...result].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      break;
    case "rating":
      result = [...result].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      break;
    default:
      result = [...result].sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }

  return result;
}

export async function getProductDetail(id: string): Promise<ProductDetail | null> {
  const db = await getDb();
  const row = await db.get<ProductRow>("SELECT * FROM products WHERE id = ?", [id]);
  if (!row) return null;
  const product = toProduct(row);

  const variantRows = await db.all<{ id: string; label: string; kind: string; extra: number | string }>(
    `SELECT id, label, kind, extra FROM product_variants
     WHERE product_id = ? AND is_active = ${db.dialect === "postgres" ? "TRUE" : "1"}
     ORDER BY sort_order ASC`,
    [id],
  );

  const specRows = await db.all<{ group_name: string; name: string; value: string; unit: string; numeric: number | null }>(
    `SELECT group_name, name, value, unit, numeric FROM product_specs
     WHERE product_id = ? AND group_name <> 'cross-sell' ORDER BY sort_order ASC`,
    [id],
  );

  const mediaRows = await db.all<{ url: string; kind: string }>(
    "SELECT url, kind FROM product_media WHERE product_id = ? ORDER BY sort_order ASC",
    [id],
  );

  const reviewRows = await db.all<{ id: string; author: string; rating: number | string; text: string; created_at: number | string }>(
    "SELECT id, author, rating, text, created_at FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 20",
    [id],
  );

  const crossRows = await db.all<{ value: string }>(
    "SELECT value FROM product_specs WHERE product_id = ? AND group_name = 'cross-sell' ORDER BY numeric ASC",
    [id],
  );

  const crossTitles = crossRows.map((r) => r.value);
  const crossSell: Product[] = [];
  for (const title of crossTitles) {
    const found = await db.get<ProductRow>(
      `SELECT * FROM products WHERE title = ? AND is_active = ${db.dialect === "postgres" ? "TRUE" : "1"}`,
      [title],
    );
    if (found) crossSell.push(toProduct(found));
  }

  const ratings = reviewRows.map((r) => Number(r.rating));
  const rating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  return {
    ...product,
    variants: variantRows.map((v) => ({
      id: v.id,
      label: v.label,
      kind: v.kind,
      extra: Number(v.extra),
    })),
    specs: specRows.map((s) => ({
      group: s.group_name,
      name: s.name,
      value: s.value,
      unit: s.unit,
      numeric: s.numeric === null ? null : Number(s.numeric),
    })),
    gallery: mediaRows.length ? mediaRows.map((m) => m.url) : [product.photoUrl],
    media: mediaRows.length
      ? mediaRows.map((m) => ({ kind: m.kind === "video" ? "video" : "image", url: m.url }))
      : [{ kind: "image", url: product.photoUrl }],
    rating: rating === null ? null : Math.round(rating * 10) / 10,
    reviewCount: reviewRows.length,
    reviews: reviewRows.map((r) => ({
      id: r.id,
      author: r.author,
      rating: Number(r.rating),
      text: r.text,
      createdAt: Number(r.created_at),
    })),
    crossSell,
  };
}

/** Сравнение 2–3 моделей: общий набор характеристик + значения по каждому товару. */
export type Comparison = {
  products: (Product & { brand: string })[];
  /** better — индекс колонки с объективно лучшим значением (только числовые спеки). */
  rows: { name: string; unit: string; values: (string | null)[]; better?: number }[];
};

export async function compareProducts(ids: string[]): Promise<Comparison | null> {
  const unique = [...new Set(ids)].slice(0, 3);
  if (unique.length < 2) return null;

  const db = await getDb();
  const products: (Product & { brand: string })[] = [];
  const specsByName = new Map<string, { unit: string; values: (string | null)[]; numerics: (number | null)[] }>();

  for (const [index, id] of unique.entries()) {
    const row = await db.get<ProductRow>("SELECT * FROM products WHERE id = ?", [id]);
    if (!row) continue;
    products.push(toProduct(row));

    const specs = await db.all<{ name: string; value: string; unit: string; numeric: number | null }>(
      `SELECT name, value, unit, numeric FROM product_specs
       WHERE product_id = ? AND group_name <> 'cross-sell' ORDER BY sort_order ASC`,
      [id],
    );

    for (const spec of specs) {
      const entry =
        specsByName.get(spec.name) ?? {
          unit: spec.unit,
          values: Array.from({ length: unique.length }, () => null),
          numerics: Array.from({ length: unique.length }, () => null),
        };
      entry.values[index] = spec.unit ? `${spec.value} ${spec.unit}` : spec.value;
      entry.numerics[index] = spec.numeric === null ? null : Number(spec.numeric);
      specsByName.set(spec.name, entry);
    }
  }

  if (products.length < 2) return null;

  const rows = [...specsByName.entries()].map(([name, entry]) => {
    // Лучшее значение — только для числовых характеристик, где «больше» объективно лучше.
    const numeric = entry.numerics.filter((n): n is number => n !== null);
    const comparable = ["Встроенная память", "SSD", "Оперативная память", "Частота", "Автономность", "Основная"];
    const best =
      numeric.length === unique.length && comparable.includes(name)
        ? entry.numerics.indexOf(Math.max(...numeric))
        : undefined;
    return { name, unit: entry.unit, values: entry.values, better: best };
  });

  return { products, rows };
}

// ─── Избранное ──────────────────────────────────────────────────────────────

export async function listFavorites(tgUserId: string): Promise<(Product & { brand: string })[]> {
  const db = await getDb();
  const rows = await db.all<ProductRow>(
    `SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id
     WHERE f.tg_user_id = ? ORDER BY f.created_at DESC`,
    [tgUserId],
  );
  return rows.map(toProduct);
}

export async function toggleFavorite(tgUserId: string, productId: string): Promise<boolean> {
  const db = await getDb();
  const existing = await db.get<{ product_id: string }>(
    "SELECT product_id FROM favorites WHERE tg_user_id = ? AND product_id = ?",
    [tgUserId, productId],
  );
  if (existing) {
    await db.run("DELETE FROM favorites WHERE tg_user_id = ? AND product_id = ?", [tgUserId, productId]);
    return false;
  }
  await db.run("INSERT INTO favorites (tg_user_id, product_id, created_at) VALUES (?, ?, ?)", [
    tgUserId,
    productId,
    Date.now(),
  ]);
  return true;
}

export async function listFavoriteIds(tgUserId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.all<{ product_id: string }>("SELECT product_id FROM favorites WHERE tg_user_id = ?", [
    tgUserId,
  ]);
  return rows.map((r) => r.product_id);
}
