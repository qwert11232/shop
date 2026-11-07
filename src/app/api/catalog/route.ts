import { NextRequest, NextResponse } from "next/server";
import { listCatalog } from "@/lib/repo";
import { seedIfEnabled } from "@/lib/seed";
import { applyFilters, listBrands, listFacets, listVisibleProducts, type CatalogFilters } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/**
 * Публичный каталог с фильтрами и сортировкой.
 *
 * GET /api/catalog                         — категории с товарами (как раньше)
 * GET /api/catalog?flat=1&search=…&brand=Apple&sort=price-asc&spec=Память:256 ГБ
 *
 * Фасеты и бренды считаются по фактическим данным, а не задаются в коде:
 * добавили товар с новой характеристикой — фильтр появился сам.
 */
export async function GET(req: NextRequest) {
  try {
    await seedIfEnabled();
    const params = req.nextUrl.searchParams;

    if (params.get("flat") !== "1") {
      const categories = await listCatalog();
      return NextResponse.json({ categories });
    }

    const filters = parseFilters(params);
    const products = await listVisibleProducts();

    // Характеристики товаров нужны фильтру по spec — берём одним запросом.
    const specs = await listSpecMap();
    // Кадры для карусели прямо в сетке: без них пришлось бы делать запрос
    // на каждую карточку. Ограничение в 4 кадра — компромисс между
    // «полистать в списке» и весом ответа.
    const media = await listMediaMap();
    const withSpecs = products.map((p) => ({
      ...p,
      specs: specs[p.id] ?? {},
      photos: (media[p.id] ?? []).slice(0, 4),
    }));
    const filtered = applyFilters(withSpecs, filters);

    return NextResponse.json({
      products: filtered,
      total: filtered.length,
      brands: await listBrands(),
      facets: await listFacets(filters.categoryId),
      filters,
    });
  } catch (err) {
    console.error("[catalog] ошибка загрузки:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Каталог временно недоступен. Проверьте подключение к базе." },
      { status: 500 },
    );
  }
}

/** spec=Память:256 ГБ повторяется в query несколько раз. */
function parseFilters(params: URLSearchParams): CatalogFilters {
  const specMap: Record<string, string[]> = {};
  for (const raw of params.getAll("spec")) {
    const [name, ...rest] = raw.split(":");
    const value = rest.join(":").trim();
    if (!name || !value) continue;
    specMap[name] = [...(specMap[name] ?? []), value];
  }

  const num = (key: string) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : undefined;
  };

  const sort = params.get("sort");
  const allowed = ["popular", "price-asc", "price-desc", "new", "rating"] as const;

  return {
    search: params.get("search") ?? undefined,
    categoryId: params.get("category") ?? undefined,
    brands: params.getAll("brand").filter(Boolean),
    minPrice: num("minPrice"),
    maxPrice: num("maxPrice"),
    specs: Object.keys(specMap).length ? specMap : undefined,
    sort: allowed.includes(sort as (typeof allowed)[number]) ? (sort as CatalogFilters["sort"]) : undefined,
  };
}

/** Первые кадры галереи по каждому товару, в порядке sort_order. */
async function listMediaMap(): Promise<Record<string, string[]>> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  const rows = await db.all<{ product_id: string; url: string }>(
    "SELECT product_id, url FROM product_media WHERE kind = 'image' ORDER BY product_id, sort_order ASC",
  );
  const map: Record<string, string[]> = {};
  for (const row of rows) {
    map[row.product_id] = [...(map[row.product_id] ?? []), row.url];
  }
  return map;
}

async function listSpecMap(): Promise<Record<string, Record<string, string>>> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  const rows = await db.all<{ product_id: string; name: string; value: string }>(
    "SELECT product_id, name, value FROM product_specs WHERE group_name <> 'cross-sell'",
  );
  const map: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    map[row.product_id] = { ...(map[row.product_id] ?? {}), [row.name]: row.value };
  }
  return map;
}
