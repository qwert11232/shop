import { NextResponse } from "next/server";
import { getDb, databaseUrl, isPostgresUrl } from "@/lib/db";
import { analyzeDatabaseUrl, dbUrlHint } from "@/lib/db-url";
import { storageDriver } from "@/lib/storage";
import { ordersReceiverConfigured } from "@/lib/telegram";
import { adminsConfigured } from "@/lib/bot-access";

export const dynamic = "force-dynamic";

/**
 * Проверка деплоя одной ссылкой: диалект БД, доступность схемы, количество
 * позиций и драйвер хранилища. Секретов не отдаёт — только имена переменных.
 */
export async function GET() {
  const url = databaseUrl();
  const driver = isPostgresUrl(url) ? "postgres" : "sqlite";
  // Диагностика строки подключения: без пароля, только хост и найденные проблемы.
  const report = analyzeDatabaseUrl(url);
  const dbCheck = {
    host: report.host || null,
    database: report.database || null,
    problems: report.problems,
    warnings: report.warnings,
  };
  const checks: Record<string, unknown> = {
    db: driver,
    databaseUrl: dbCheck,
    autoSeed: process.env.AUTO_SEED ?? (process.env.VERCEL ? "1 (по умолчанию)" : "0"),
    storage: storageDriver() ?? "не настроено",
    // `telegram` — есть ли куда отправить заказ: группа или личка админов.
    telegram: ordersReceiverConfigured(),
    ordersTo: process.env.GROUP_CHAT_ID?.trim() ? "group" : adminsConfigured() ? "admin-dm" : "нет",
    botAdmin: adminsConfigured(),
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
        // Подсказка только про строку подключения: прочие причины остаются в error.
        hint: dbUrlHint(report) || undefined,
        checks,
      },
      { status: 500 },
    );
  }
}
