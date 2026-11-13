import { NextRequest, NextResponse } from "next/server";
import {
  getMe,
  getWebhookInfo,
  setChatMenuButton,
  setMyCommands,
  setWebhook,
  takeLastError,
} from "@/lib/bot-api";
import { adminsConfigured, adminIds, adminUsernames, appUrl } from "@/lib/bot-access";

export const dynamic = "force-dynamic";

/**
 * Одноразовая настройка бота: POST/GET /api/bot/setup?token=<BOT_SETUP_TOKEN>
 *
 * Делает три вещи: ставит webhook на этот деплой, регистрирует команды меню,
 * показывает getWebhookInfo. Любая проблема возвращается JSON-ом с причиной —
 * иначе в браузере видно только «функция упала».
 *
 * Доступ: заголовок `x-telegram-init-data` от владельца ЛИБО ?token=BOT_SETUP_TOKEN.
 * Если не задано ни BOT_SETUP_TOKEN, ни админы — настройка закрыта.
 */

/**
 * Два набора команд: покупателю — про его заказы, админу — про магазин.
 * Telegram показывает владельцу свой список по scope, остальным — дефолтный.
 */
const CLIENT_COMMANDS = [
  { command: "start", description: "Мои заказы и корзина" },
  { command: "orders", description: "Мои заказы" },
  { command: "cart", description: "Корзина" },
  { command: "bonus", description: "Бонусы" },
  { command: "help", description: "Как мы работаем" },
];

const ADMIN_COMMANDS = [
  { command: "start", description: "Панель магазина" },
  { command: "new", description: "Добавить товар" },
  { command: "products", description: "Товары: цена, фото, варианты" },
  { command: "orders", description: "Заказы и доставка" },
  { command: "customers", description: "Покупатели и бонусы" },
  { command: "stats", description: "Сводка магазина" },
  { command: "find", description: "Найти товар" },
  { command: "help", description: "Справка" },
];

type Step = { step: string; ok: boolean; detail?: unknown };

async function handler(req: NextRequest) {
  if (req.method !== "GET" && req.method !== "POST") {
    return NextResponse.json({ error: "Метод не поддерживается" }, { status: 405 });
  }

  const url = new URL(req.url);
  const token = process.env.BOT_SETUP_TOKEN?.trim();
  const provided = url.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error: "BOT_SETUP_TOKEN не задан",
        hint: "Добавьте BOT_SETUP_TOKEN в переменные окружения и откройте ссылку с ?token=…",
        admins: { ids: adminIds().length, usernames: adminUsernames().length },
      },
      { status: 503 },
    );
  }
  if (provided !== token) {
    return NextResponse.json(
      { ok: false, error: "Нет доступа к настройке", hint: "Откройте ссылку с ?token=<BOT_SETUP_TOKEN>" },
      { status: 401 },
    );
  }

  const secret = process.env.BOT_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "BOT_WEBHOOK_SECRET не задан",
        hint: "Нужна строка 1–256 символов: A-Z, a-z, 0-9, _ или -. Без неё вебхук не принимает апдейты.",
      },
      { status: 503 },
    );
  }

  const steps: Step[] = [];
  const base = appUrl();
  const webhookUrl = `${base}/api/bot/webhook`;

  const me = await getMe();
  steps.push({ step: "getMe", ok: Boolean(me), detail: me ? `@${me.username ?? me.id}` : takeLastError() });

  const webhookSet = await setWebhook(webhookUrl, secret);
  steps.push({ step: "setWebhook", ok: Boolean(webhookSet), detail: webhookSet ? webhookUrl : takeLastError() });

  // Дефолтный набор — покупательский: он для большинства людей в боте.
  const clientCommands = await setMyCommands(CLIENT_COMMANDS);
  steps.push({ step: "setMyCommands:client", ok: Boolean(clientCommands), detail: CLIENT_COMMANDS.length });

  // Каждому админу — его набор, чтобы меню не сбивало с толку.
  const adminChats = adminIds()
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const adminResults = await Promise.all(
    adminChats.map((chatId) => setMyCommands(ADMIN_COMMANDS, { type: "chat", chat_id: chatId })),
  );
  steps.push({
    step: "setMyCommands:admins",
    ok: adminResults.every(Boolean),
    detail: { chats: adminChats.length, applied: adminResults.filter(Boolean).length },
  });

  // Кнопка меню в личке — тоже мини-апп, иначе у покупателя нет точки входа.
  const menuButton = await setChatMenuButton(base);
  steps.push({ step: "setChatMenuButton", ok: Boolean(menuButton), detail: menuButton ? base : takeLastError() });

  const info = await getWebhookInfo();
  steps.push({ step: "getWebhookInfo", ok: Boolean(info), detail: info ?? takeLastError() });

  const ok = Boolean(me && webhookSet);
  console.info("[bot/setup]", { webhookUrl, ok, adminsConfigured: adminsConfigured() });

  return NextResponse.json(
    {
      ok,
      webhook: webhookUrl,
      app: base,
      admins: {
        configured: adminsConfigured(),
        ids: adminIds().length,
        usernames: adminUsernames().length,
      },
      steps,
      ...(ok ? {} : { hint: "Проверьте BOT_TOKEN, WEBAPP_URL и доступность домена из Telegram" }),
    },
    { status: ok ? 200 : 502 },
  );
}

export const GET = handler;
export const POST = handler;
