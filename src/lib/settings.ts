/**
 * Настройки магазина, которые владелец меняет прямо в боте.
 *
 * Зачем таблица, а не переменные окружения: реквизиты оплаты и ссылку на оплату
 * владелец должен менять сам, без деплоя. Vercel-переменные для этого не годятся —
 * их правка требует пересборки, а пересборка сбрасывает сессии бота.
 *
 * Хранилище — key/value пара в таблице `settings`: новых сущностей не заводим,
 * список настроек живёт в коде (`SETTING_DEFS`), поэтому добавление строки не
 * требует миграции.
 *
 * ВАЖНО про безопасность: значения настроек уходят клиенту (реквизиты, ссылка
 * на оплату). Поэтому ключи с секретами сюда не кладём — для них есть
 * переменные окружения.
 */

import { getDb } from "./db";

export type SettingKey = "payment_details" | "payment_link" | "payment_note" | "shop_phone";

export type SettingDef = {
  key: SettingKey;
  label: string;
  /** Что это и зачем — показывается владельцу в панели. */
  hint: string;
  /** Пример, чтобы было понятно, что вводить. */
  example: string;
  maxLength: number;
};

/**
 * Порядок важен: он же порядок кнопок в экране «Оплата».
 * `payment_details` — реквизиты текстом (карта, СБП по номеру телефона),
 * `payment_link` — ссылка на оплату (ЮKassa, Т-Банк, Robokassa),
 * `payment_note` — короткая приписка («чек пришлём в чат»),
 * `shop_phone` — телефон для связи, его же видит клиент в уведомлениях.
 */
export const SETTING_DEFS: SettingDef[] = [
  {
    key: "payment_details",
    label: "Реквизиты",
    hint: "Карта или телефон для СБП. Клиент получит их вместе с суммой к оплате.",
    example: "СБП по номеру +7 900 000-00-00, получатель Иван И.",
    maxLength: 300,
  },
  {
    key: "payment_link",
    label: "Ссылка на оплату",
    hint: "Если принимаете оплату по ссылке (ЮKassa, Т-Банк). Кнопка появится у клиента.",
    example: "https://pay.example.com/order",
    maxLength: 300,
  },
  {
    key: "payment_note",
    label: "Приписка к оплате",
    hint: "Одна строка, которую клиент видит под суммой. Например, про чек.",
    example: "Чек и гарантию пришлём в этот чат после оплаты.",
    maxLength: 200,
  },
  {
    key: "shop_phone",
    label: "Телефон магазина",
    hint: "Для связи. Показывается клиенту в уведомлениях о заказе.",
    example: "+7 900 000-00-00",
    maxLength: 40,
  },
];

export function settingDef(key: string): SettingDef | undefined {
  return SETTING_DEFS.find((def) => def.key === key);
}

export function isSettingKey(value: string): value is SettingKey {
  return SETTING_DEFS.some((def) => def.key === value);
}

export type ShopSettings = Record<SettingKey, string>;

const EMPTY: ShopSettings = {
  payment_details: "",
  payment_link: "",
  payment_note: "",
  shop_phone: "",
};

export async function getSettings(): Promise<ShopSettings> {
  const db = await getDb();
  const rows = await db.all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const result: ShopSettings = { ...EMPTY };
  for (const row of rows) {
    if (isSettingKey(row.key)) result[row.key] = row.value;
  }
  return result;
}

export async function getSetting(key: SettingKey): Promise<string> {
  const db = await getDb();
  const row = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? "";
}

/**
 * Запись настройки. Пустая строка — это «стереть»: так владелец убирает
 * реквизиты, когда меняет банк. Читаем после записи, чтобы вернуть то, что
 * реально лежит в базе (а не то, что мы думали туда положили).
 */
export async function setSetting(key: SettingKey, value: string): Promise<void> {
  const db = await getDb();
  const def = settingDef(key);
  const trimmed = value.trim().slice(0, def?.maxLength ?? 300);
  if (!trimmed) {
    await db.run("DELETE FROM settings WHERE key = ?", [key]);
    return;
  }
  const existing = await db.get<{ key: string }>("SELECT key FROM settings WHERE key = ?", [key]);
  if (existing) {
    await db.run("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?", [trimmed, Date.now(), key]);
    return;
  }
  await db.run("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)", [key, trimmed, Date.now()]);
}

/**
 * Разбор введённой ссылки: в чате легко прислать «pay.ru» или скопировать
 * адрес с мусором. Возвращает нормализованный URL или причину отказа —
 * владелец должен понимать, что не так, а не получать «неверно».
 */
export function parsePaymentLink(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "Пусто. Пришлите ссылку или нажмите «Удалить»." };
  if (/\s/.test(value)) return { ok: false, reason: "В ссылке пробел. Скопируйте адрес из кабинета банка." };
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "Это не похоже на ссылку. Пример: https://pay.example.com/order" };
  }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: "Нужна обычная ссылка http:// или https://" };
  if (!url.hostname.includes(".")) return { ok: false, reason: "В ссылке нет домена. Пример: pay.example.com/order" };
  return { ok: true, url: url.toString() };
}

/** Готовы ли принимать оплату: есть хотя бы реквизиты или ссылка. */
export function paymentConfigured(settings: ShopSettings): boolean {
  return Boolean(settings.payment_details || settings.payment_link);
}
