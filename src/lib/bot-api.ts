/**
 * Клиент Telegram Bot API для серверных route-хендлеров.
 * Токен берётся только из окружения и никогда не попадает в логи и ответы:
 * в тексте ошибки — метод и код ответа, без URL с токеном.
 */

export type InlineButton = { text: string; callback_data: string } | { text: string; url: string };
export type Keyboard = { inline_keyboard: InlineButton[][] };

export type BotUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type BotMessage = {
  message_id: number;
  from?: BotUser;
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }[];
};

export type BotUpdate = {
  update_id: number;
  message?: BotMessage;
  callback_query?: {
    id: string;
    from: BotUser;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

export type ApiError = { method: string; status: number; code?: number; description?: string };

let lastError: ApiError | null = null;

export function takeLastError(): ApiError | null {
  const error = lastError;
  lastError = null;
  return error;
}

export function botToken(): string | null {
  const token = process.env.BOT_TOKEN?.trim();
  return token || null;
}

export async function callBot<T>(
  method: string,
  payload: Record<string, unknown>,
): Promise<T | null> {
  const token = botToken();
  if (!token) {
    lastError = { method, status: 503, description: "BOT_TOKEN не задан" };
    return null;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      // Telegram ждёт ответ быстро; зависший вызов не должен держать вебхук.
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      error_code?: number;
      description?: string;
    };
    if (!res.ok || !data.ok) {
      lastError = {
        method,
        status: res.status,
        code: data.error_code,
        description: data.description,
      };
      console.error(`[bot] ${method} failed: ${res.status} ${data.description ?? ""}`.trim());
      return null;
    }
    return (data.result ?? null) as T | null;
  } catch (err) {
    lastError = { method, status: 0, description: err instanceof Error ? err.message : "network" };
    console.error(`[bot] ${method} error:`, lastError.description);
    return null;
  }
}

export function sendMessage(chatId: number | string, text: string, keyboard?: Keyboard) {
  return callBot("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

export function editMessage(chatId: number | string, messageId: number, text: string, keyboard?: Keyboard) {
  return callBot("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

export function answerCallback(id: string, text?: string) {
  return callBot("answerCallbackQuery", { callback_query_id: id, text, show_alert: false });
}

export function setWebhook(url: string, secret: string) {
  return callBot<boolean>("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export function deleteWebhook() {
  return callBot<boolean>("deleteWebhook", { drop_pending_updates: true });
}

export function getWebhookInfo() {
  return callBot<Record<string, unknown>>("getWebhookInfo", {});
}

export function getMe() {
  return callBot<{ id: number; username?: string; first_name: string }>("getMe", {});
}

export function setMyCommands(commands: { command: string; description: string }[]) {
  return callBot<boolean>("setMyCommands", { commands });
}

/** file_id → готовый URL картинки (для фото из чата: обложка товара). */
export async function getFileUrl(fileId: string): Promise<string | null> {
  const file = await callBot<{ file_path?: string }>("getFile", { file_id: fileId });
  const token = botToken();
  if (!file?.file_path || !token) return null;
  return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
}
