import type { Product, Order, OrderStatus } from "./repo";

const formatPrice = (kopecks: number) =>
  `${(kopecks / 100).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;
import { isBotAdmin } from "./bot-access";
import type { BotUpdate, Keyboard } from "./bot-api";

/**
 * Сообщение о заявке, которое уходит в группу магазина.
 * Текст — разметка Telegram (эмодзи читаются в мессенджере быстрее строк),
 * кнопки статуса появляются только если в окружении задан BOT_TOKEN:
 * без бота нажатие уходило бы в никуда.
 */
export function orderMessageText(opts: {
  product: Pick<Product, "title" | "price">;
  userName: string;
  comment: string;
  date: Date;
}): string {
  const when = opts.date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  const lines = [
    "🛒 Новая заявка — ТЕХНОЛАБ",
    "",
    `📦 Позиция: ${opts.product.title}`,
    `💰 Цена: ${formatPrice(opts.product.price)}`,
    `👤 Клиент: ${opts.userName}`,
  ];
  if (opts.comment.trim()) lines.push(`💬 Комментарий: ${opts.comment.trim()}`);
  lines.push(`🕐 ${when}`);
  return lines.join("\n");
}

export function orderKeyboard(orderId: string): Keyboard | undefined {
  if (!process.env.BOT_TOKEN) return undefined;
  return {
    inline_keyboard: [
      [
        { text: "В работу", callback_data: `status:${orderId}:contacted` },
        { text: "Выполнена", callback_data: `status:${orderId}:done` },
        { text: "Отменить", callback_data: `status:${orderId}:cancelled` },
      ],
    ],
  };
}

/** Подпись статуса для сообщения в группе (после нажатия кнопки). */
export function withStatusLine(text: string, status: OrderStatus, actor: string): string {
  const label: Record<OrderStatus, string> = {
    new: "новая",
    contacted: "в работе",
    done: "выполнена",
    cancelled: "отменена",
  };
  return `${text}\n\n— статус: ${label[status]} (${actor})`;
}

/**
 * Разбор callback_data вида `status:<orderId>:<status>`.
 * id заявки содержит дефисы, но не двоеточия, поэтому split по «:» безопасен,
 * а статус берём последним сегментом.
 */
export function parseStatusAction(data: string): { orderId: string; status: string } | null {
  if (!data.startsWith("status:")) return null;
  const rest = data.slice("status:".length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon <= 0) return null;
  return { orderId: rest.slice(0, lastColon), status: rest.slice(lastColon + 1) };
}

export function actorName(update: BotUpdate): string {
  const from = update.callback_query?.from ?? update.message?.from;
  return from?.first_name ?? "админ";
}

export { isBotAdmin };
export type { Order };
