import { NextResponse } from "next/server";
import { getDb, databaseUrl, isPostgresUrl } from "@/lib/db";
import { storageDriver } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Проверка деплоя одной ссылкой: диалект БД, доступность схемы, количество
 * позиций и драйвер хранилища. Секретов не отдаёт — только имена переменных.
 */
export async function GET() {
  const url = databaseUrl();
  const driver = isPostgresUrl(url) ? "postgres" : "sqlite";
  const checks: Record<string, unknown> = {
    db: driver,
    autoSeed: process.env.AUTO_SEED ?? (process.env.VERCEL ? "1 (по умолчанию)" : "0"),
    storage: storageDriver() ?? "не настроено",
    telegram: Boolean(process.env.BOT_TOKEN && process.env.GROUP_CHAT_ID),
    owner: Boolean(process.env.OWNER_TELEGRAM_ID),
  };

  try {
    const db = await getDb();
    const categories = await db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM categories");
    const products = await db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM products");
    const counts = { categories: Number(categories?.c ?? 0), products: Number(products?.c ?? 0) };
    const healthy = counts.categories > 0 && counts.products > 0;

    return NextResponse.json(
      { ok: healthy, dialect: db.dialect, counts, checks },
      { status: healthy ? 200 : 503 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        dialect: driver,
        error: err instanceof Error ? err.message : "unknown",
        checks,
      },
      { status: 500 },
    );
  }
}
