import { NextResponse } from "next/server";
import { listCatalog } from "@/lib/repo";
import { seedIfEnabled } from "@/lib/seed";

export const dynamic = "force-dynamic";

/**
 * Публичный каталог: активные категории с активными товарами.
 * На деплое первый запрос наполняет пустую базу стартовым каталогом (AUTO_SEED).
 */
export async function GET() {
  try {
    await seedIfEnabled();
    const categories = await listCatalog();
    console.log(
      `[catalog] категорий ${categories.length}, товаров ${categories.reduce((n, c) => n + c.products.length, 0)}`,
    );
    return NextResponse.json({ categories });
  } catch (err) {
    console.error("[catalog] ошибка загрузки:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Каталог временно недоступен. Проверьте подключение к базе." },
      { status: 500 },
    );
  }
}
