import crypto from "crypto";
import { orderKeyboard } from "./order-message";

// avoid-ai-design-ignore-file: I2

import { isBotAdmin } from "./bot-access";

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

/**
 * Один и тот же список админов для бота и для веба.
 *
 * Раньше здесь читался только `OWNER_TELEGRAM_ID`, а бот — `ADMIN_TELEGRAM_IDS`.
 * Из-за этого человек, добавленный в админы бота, получал 403 в админских
 * роутах витрины. Права обязаны считаться в одном месте.
 */
export function isOwner(user: TgUser | null): boolean {
  return isBotAdmin(user);
}

export function userLabel(user: TgUser | null): string {
  if (!user) return "Гость";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const uname = user.username ? ` @${user.username}` : "";
  return `${name || "Пользователь"}${uname}`;
}

/**
 * Текст заявки, который уходит в группу Telegram.
 * Эмодзи здесь — разметка сообщения в мессенджере, а не иконки интерфейса:
 * в Telegram они читаются быстрее строк и не вводят цвета в UI.
 * Трафаретные эмодзи в мессенджере сохраняем осознанно (файл помечен ниже).
 */
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

/**
 * Отправка сообщения о заявке в группу. Если бот настроен, к сообщению
 * цепляются кнопки смены статуса — владелец меняет статус прямо в группе.
 */
/**
 * Куда отправлять заказ.
 *
 * `GROUP_CHAT_ID` — группа магазина, но пока её нет, заказ нельзя терять:
 * поэтому при пустой переменной сообщение уходит администраторам в личку
 * (`ADMIN_TELEGRAM_IDS`). Значение `me` тоже означает «в личку админам» —
 * так проще на старте, чем заводить группу ради теста.
 *
 * Каждая проблема отдельная: если один админ заблокировал бота, остальные
 * всё равно получат заказ.
 */
type OrderTarget = { chatId: string; admin: boolean };

function orderRecipients(): OrderTarget {
  const raw = process.env.GROUP_CHAT_ID?.trim() ?? "";
  if (raw && raw !== "me") return { chatId: raw, admin: false };
  const ids = (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  // OWNER_TELEGRAM_ID — историческая переменная, тоже считаем получателем.
  const owner = process.env.OWNER_TELEGRAM_ID?.trim();
  if (owner && !ids.includes(owner)) ids.push(owner);
  return { chatId: ids[0] ?? "", admin: true };
}

/** Все админы — по одному сообщению, чтобы заказ увидел каждый. */
function adminRecipients(): string[] {
  const ids = (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const owner = process.env.OWNER_TELEGRAM_ID?.trim();
  if (owner && !ids.includes(owner)) ids.push(owner);
  return ids;
}

export async function sendGroupMessage(text: string, orderId?: string): Promise<string | null> {
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  const { chatId, admin } = orderRecipients();
  if (!chatId) return null;
  try {
    const replyMarkup = orderId ? orderKeyboard(orderId) : undefined;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    const data = await res.json();
    if (data?.ok && data?.result?.message_id) {
      // В личку админам — дублируем остальным: заказ не должен зависеть от того,
      // кто из владельцев первым открыл чат.
      if (admin) {
        for (const extra of adminRecipients().slice(1)) {
          await sendPlain(extra, text, replyMarkup);
        }
      }
      return String(data.result.message_id);
    }
    console.error("[telegram] sendMessage failed:", JSON.stringify(data).slice(0, 300));
    return null;
  } catch (err) {
    console.error("[telegram] sendMessage error:", err);
    return null;
  }
}

/** Вспомогательная отправка без разбора ответа: сбой одного админа не валит заказ. */
async function sendPlain(chatId: string, text: string, replyMarkup?: unknown): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch (err) {
    console.error("[telegram] копия заказа не ушла:", err instanceof Error ? err.message : err);
  }
}

/** Есть ли куда отправить заказ: группа, админы или владелец. */
export function ordersReceiverConfigured(): boolean {
  return Boolean(process.env.BOT_TOKEN && orderRecipients().chatId);
}

export function formatPrice(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;
}

/**
 * Уведомление клиенту о статусе его заказа.
 *
 * Шлём напрямую в личку (`tg_user_id`), а не через группу: клиент мог давно
 * закрыть Mini App, и статус иначе увидит только когда зайдёт снова.
 * Ошибка отправки не должна ломать смену статуса — заказ важнее уведомления,
 * поэтому результат возвращается как «ушло / не ушло», без исключений.
 */
export async function notifyCustomer(tgUserId: string | null | undefined, text: string): Promise<boolean> {
  const token = process.env.BOT_TOKEN;
  if (!token || !tgUserId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tgUserId, text, link_preview_options: { is_disabled: true } }),
    });
    const data = await res.json();
    if (data?.ok) return true;
    // 403 — клиент заблокировал бота: это нормальная ситуация, не ошибка приложения.
    console.warn("[telegram] уведомление клиенту не ушло:", tgUserId, data?.description ?? "");
    return false;
  } catch (err) {
    console.error("[telegram] notifyCustomer error:", err instanceof Error ? err.message : err);
    return false;
  }
}
