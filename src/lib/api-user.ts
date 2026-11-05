import type { NextRequest } from "next/server";
import { resolveUser, type TgUser } from "./telegram";

/**
 * Пользователь запроса для клиентских API. Отличие от админских роутов:
 * здесь аноним допустим только как гость (в корзину/избранное ему некуда писать).
 * initData передаётся заголовком от мини-аппа либо в теле запроса.
 */
export function requestUser(req: NextRequest, body?: { initData?: string }): TgUser | null {
  const initData = req.headers.get("x-telegram-init-data") || body?.initData || "";
  return resolveUser(initData, req.headers.get("host"));
}

/** id пользователя строкой или null: в БД все внешние id текстовые. */
export function userId(user: TgUser | null): string | null {
  return user ? String(user.id) : null;
}

export const NO_AUTH = { error: "Откройте приложение в Telegram" } as const;
