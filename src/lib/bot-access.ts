import type { BotUser } from "./bot-api";

/**
 * Кто может управлять магазином через бота. Права проверяются ТОЛЬКО здесь,
 * на сервере: ни один экран и ни одна кнопка не решают доступ.
 *
 * Приоритет источников:
 *   1. `ADMIN_TELEGRAM_IDS` — числовые ID через запятую (надёжно: username меняется);
 *   2. `ADMIN_TELEGRAM_USERNAMES` — запасной способ, без @;
 *   3. `OWNER_TELEGRAM_ID` — совместимость с уже настроенной переменной админки.
 *
 * Пустой список = доступ закрыт полностью. Никаких «ID по умолчанию» в коде:
 * в референсе владелец зашит, но здесь это чужой человек, а не наш магазин.
 */
function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function adminIds(): string[] {
  return [...parseList(process.env.ADMIN_TELEGRAM_IDS), ...parseList(process.env.OWNER_TELEGRAM_ID)];
}

export function adminUsernames(): string[] {
  return parseList(process.env.ADMIN_TELEGRAM_USERNAMES).map((name) =>
    name.replace(/^@/, "").toLowerCase(),
  );
}

export function isBotAdmin(user: Pick<BotUser, "id" | "username"> | null | undefined): boolean {
  if (!user) return false;
  const ids = adminIds();
  const usernames = adminUsernames();
  if (ids.length === 0 && usernames.length === 0) return false;
  if (ids.includes(String(user.id))) return true;
  return Boolean(user.username && usernames.includes(user.username.toLowerCase()));
}

/** Ничего не настроено — бот должен честно сказать это, а не молчать. */
export function adminsConfigured(): boolean {
  return adminIds().length > 0 || adminUsernames().length > 0;
}

/** Ссылка на приложение для кнопок «Открыть витрину». */
export function appUrl(): string {
  const raw = process.env.WEBAPP_URL?.trim();
  return (raw || "https://shop-murex-gamma.vercel.app").replace(/\/$/, "");
}
