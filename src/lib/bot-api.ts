/**
 * Клиент Telegram Bot API для серверных route-хендлеров.
 * Токен берётся только из окружения и никогда не попадает в логи и ответы:
 * в тексте ошибки — метод и код ответа, без URL с токеном.
 */

/**
 * Кнопка Mini App — `web_app`, а не `url`.
 *
 * Разница принципиальная: обычная ссылка открывает сайт в браузере, где нет
 * `Telegram.WebApp.initData` — приложение не узнаёт, кто пришёл, и показывает
 * гостя. `web_app` открывает мини-апп внутри Telegram и передаёт данные
 * пользователя, подписанные ботом.
 */
export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }
  | { text: string; web_app: { url: string } };
export type Keyboard = { inline_keyboard: InlineButton[][] };

/**
 * Кнопка нижней клавиатуры. Такие кнопки не редактируют сообщение: нажатие
 * приходит как обычный текст. Покупателю это и нужно — панель разделов висит
 * под полем ввода и не даёт меню уехать вверх по чату.
 */
export type ReplyButton = { text: string };

/** Нижняя клавиатура: `reply_markup.keyboard`. */
export type ReplyKeyboard = {
  keyboard: ReplyButton[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
};

/** Любая клавиатура, которую умеет отправлять Bot API. */
export type ReplyMarkup = Keyboard | ReplyKeyboard;

/** `reply_markup.keyboard` — нижняя панель, остальное — inline-кнопки. */
export function isReplyKeyboard(markup: ReplyMarkup): markup is ReplyKeyboard {
  return Array.isArray((markup as ReplyKeyboard).keyboard);
}

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

/**
 * Адрес Bot API. Переопределяется `BOT_API_BASE` — это нужно проверкам:
 * они поднимают локальную заглушку и видят точные тексты, которые уходят
 * в Telegram, не имея настоящего токена.
 */
function apiBase(): string {
  return (process.env.BOT_API_BASE?.trim() || "https://api.telegram.org").replace(/\/$/, "");
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
    const res = await fetch(`${apiBase()}/bot${token}/${method}`, {
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

/**
 * `keyboard` — инлайн-кнопки (или нижняя панель, если передать её).
 * `replyKeyboard` — нижняя панель отдельным полем: `editMessageText` её не
 * умеет, поэтому при возврате в меню её надо отправить новым сообщением.
 */
/**
 * Одно сообщение — одна клавиатура: `reply_markup` в Bot API один.
 *
 * Нижняя панель при этом не «сгорает»: она живёт под полем ввода, пока её не
 * заменят. Поэтому панель ставится экраном меню, а дальше сообщения идут со
 * своими инлайн-кнопками — как в привычных ботах, где сверху текст с кнопкой,
 * а снизу постоянные разделы.
 */
export function sendMessage(chatId: number | string, text: string, keyboard?: ReplyMarkup) {
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

/**
 * Ответ на нажатие кнопки. `alert` показывает всплывающее окно вместо короткой
 * плашки — нужно, когда владельцу важно не пропустить (например, «уведомление
 * клиенту не ушло, бот заблокирован»).
 */
export function answerCallback(id: string, text?: string, alert = false) {
  return callBot("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert });
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

/**
 * Команды меню. `scope` позволяет показать разный список админу и покупателю:
 * Telegram сам решает, какой набор рисовать, по chat_id из scope.
 */
export function setMyCommands(
  commands: { command: string; description: string }[],
  scope?: { type: "default" } | { type: "chat"; chat_id: number },
) {
  return callBot<boolean>("setMyCommands", scope ? { commands, scope } : { commands });
}

/**
 * Кнопка «меню» слева от поля ввода в личке с ботом.
 *
 * `web_app` открывает магазин как мини-апп: с данными покупателя. Если оставить
 * обычный `default`, Telegram никогда не покажет точку входа в приложение.
 */
export function setChatMenuButton(url: string) {
  return callBot<boolean>("setChatMenuButton", {
    menu_button: { type: "web_app", text: "Витрина", web_app: { url } },
  });
}

/** file_id → готовый URL картинки (для фото из чата: обложка товара). */
export async function getFileUrl(fileId: string): Promise<string | null> {
  const file = await callBot<{ file_path?: string }>("getFile", { file_id: fileId });
  const token = botToken();
  if (!file?.file_path || !token) return null;
  return `${apiBase()}/file/bot${token}/${file.file_path}`;
}
