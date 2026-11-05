import crypto from "crypto";

export type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

/**
 * Проверка Telegram WebApp initData по HMAC-SHA256 (документация Telegram:
 * secret key = HMAC_SHA256("WebAppData", bot_token), data_check_string —
 * все пары key=value кроме hash, отсортированные по ключу, через \n).
 */
export function validateInitData(initData: string, botToken: string): TgUser | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const calc = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest();
    const given = Buffer.from(hash, "hex");
    // Сравнение постоянного времени: длина сверяется отдельно, timingSafeEqual на разной длине бросает.
    if (given.length !== calc.length || !crypto.timingSafeEqual(given, calc)) return null;

    const authDate = Number(params.get("auth_date"));
    // auth_date обязателен: без него нельзя проверить срок жизни initData.
    if (!Number.isFinite(authDate) || authDate <= 0) return null;
    // initData старше 24 часов считаем протухшим
    if (Date.now() / 1000 - authDate > 86400) return null;

    const userRaw = params.get("user");
    if (!userRaw) return null;
    const user = JSON.parse(userRaw) as TgUser;
    if (typeof user.id !== "number") return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * Пользователь из запроса: валидный initData ИЛИ dev-режим (только локально).
 * `host` передаётся из запроса: dev-обход не должен работать на публичном домене.
 */
export function resolveUser(initData: string, host: string | null = null): TgUser | null {
  if (initData && process.env.BOT_TOKEN) {
    const user = validateInitData(initData, process.env.BOT_TOKEN);
    if (user) return user;
  }
  if (process.env.ALLOW_DEV_NO_AUTH === "1" && process.env.NODE_ENV !== "production" && isDevHost(host)) {
    return {
      id: Number(process.env.OWNER_TELEGRAM_ID || 1),
      first_name: "Владелец",
      username: "owner_dev",
    };
  }
  return null;
}

/**
 * Разрешённые хосты для dev-обхода: localhost/127.0.0.1, явный список
 * DEV_NO_AUTH_HOSTS (через запятую) и домены песочницы предпросмотра *.e2b.app.
 */
function isDevHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, "").toLowerCase();
  if (name === "localhost" || name === "127.0.0.1" || name === "[::1]") return true;
  if (name.endsWith(".e2b.app")) return true;
  const allowed = (process.env.DEV_NO_AUTH_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(name);
}

export function isOwner(user: TgUser | null): boolean {
  const ownerId = process.env.OWNER_TELEGRAM_ID;
  if (!ownerId || !user) return false;
  return String(user.id) === ownerId;
}

export function userLabel(user: TgUser | null): string {
  if (!user) return "Гость";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const uname = user.username ? ` @${user.username}` : "";
  return `${name || "Пользователь"}${uname}`;
}

/** Текст заявки, который уходит в группу Telegram. */
export function buildOrderMessage(opts: {
  productTitle: string;
  priceKopecks: number;
  userLabel: string;
  comment?: string;
  date: Date;
}): string {
  const price = formatPrice(opts.priceKopecks);
  const date = opts.date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const lines = [
    "🛒 Новая заявка — ТЕХНОЛАБ",
    "",
    `📦 Позиция: ${opts.productTitle}`,
    `💰 Цена: ${price}`,
    `👤 Заинтересовалась/лся: ${opts.userLabel}`,
  ];
  if (opts.comment?.trim()) lines.push(`💬 Комментарий: ${opts.comment.trim()}`);
  lines.push(`🕐 ${date}`);
  return lines.join("\n");
}

/** Отправка сообщения в группу через Bot API. Возвращает message_id или null. */
export async function sendGroupMessage(text: string): Promise<string | null> {
  const token = process.env.BOT_TOKEN;
  const chatId = process.env.GROUP_CHAT_ID;
  if (!token || !chatId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json();
    if (data?.ok && data?.result?.message_id) return String(data.result.message_id);
    console.error("[telegram] sendMessage failed:", JSON.stringify(data).slice(0, 300));
    return null;
  } catch (err) {
    console.error("[telegram] sendMessage error:", err);
    return null;
  }
}

export function formatPrice(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}
