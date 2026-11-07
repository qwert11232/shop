import type { AdminOrder, Category, OrderStatus, Product } from "./repo";
import type { CustomerSummary } from "./shop";
import type { InlineButton, Keyboard } from "./bot-api";
import { appUrl } from "./bot-access";
import { deliveryLabel, nextDeliveryStep, trackAllowed } from "./shop";
import { esc, money, shortDate } from "./bot-screens";
import { SETTING_DEFS, type ShopSettings } from "./settings";

/**
 * Экраны панели: добавление товара, правка категории/бренда/описания, фото,
 * варианты, характеристики, покупатели, бонусы.
 *
 * Разделено с `bot-screens.ts`, потому что это другой сценарий: там заявки и
 * товары «на посмотреть», здесь — пошаговый ввод. Как и там, функции чистые:
 * данные на вход, текст и клавиатура на выход, поэтому проверяются без сети.
 */

export const CATEGORY_HINT = "Категории:";
export const LIMIT_TITLE = 120;
export const LIMIT_DESCRIPTION = 900;

// ─── Список товаров ────────────────────────────────────────────────────────

const PAGE_SIZE = 5;

export function productsListScreen(products: Product[], page: number, query = ""): { text: string; keyboard: Keyboard } {
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const slice = products.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const header = query
    ? `<b>Поиск:</b> ${esc(query)} — найдено ${products.length}`
    : `<b>Товары</b> — ${products.length} шт., стр. ${current + 1}/${pages}`;

  if (slice.length === 0) {
    return {
      text: `${header}\n\n<i>Ничего не найдено.</i>`,
      keyboard: {
        inline_keyboard: [
          [{ text: "Добавить товар", callback_data: "add:new" }],
          [{ text: "‹ Меню", callback_data: "menu" }],
        ],
      },
    };
  }

  const lines = slice.map((p, index) => {
    const hidden = p.isActive ? "" : " · <i>скрыт</i>";
    return `${current * PAGE_SIZE + index + 1}. ${esc(p.title)} — ${money(p.price)}${hidden}`;
  });

  const nav: InlineButton[] = [];
  if (current > 0) nav.push({ text: "‹ Назад", callback_data: query ? `find:${current - 1}` : `products:${current - 1}` });
  if (current < pages - 1) nav.push({ text: "Дальше ›", callback_data: query ? `find:${current + 1}` : `products:${current + 1}` });

  return {
    text: `${header}\n\n${lines.join("\n")}\n\n<i>Нажмите номер, чтобы открыть товар.</i>`,
    keyboard: {
      inline_keyboard: [
        slice.map((p, index) => ({ text: String(current * PAGE_SIZE + index + 1), callback_data: `product:${p.id}` })),
        ...(nav.length ? [nav] : []),
        [
          { text: "Добавить", callback_data: "add:new" },
          { text: "Найти", callback_data: "find:ask" },
        ],
        [{ text: "Массовые действия", callback_data: "bulk" }],
        [{ text: "‹ Меню", callback_data: "menu" }],
      ],
    },
  };
}

// ─── Карточка товара ───────────────────────────────────────────────────────

export function productAdminScreen(product: Product & { categoryName?: string | null; brand?: string }): {
  text: string;
  keyboard: Keyboard;
} {
  const brand = product.brand ?? "";
  const text = [
    `<b>${esc(product.title)}</b>`,
    product.oldPrice > product.price
      ? `Цена: <b>${money(product.price)}</b>  <s>${money(product.oldPrice)}</s>`
      : `Цена: <b>${money(product.price)}</b>`,
    `Бренд: ${brand ? esc(brand) : "<i>не указан</i>"}`,
    `Категория: ${esc(product.categoryName ?? "—")}`,
    `Статус: ${product.isActive ? "на витрине" : "<i>скрыт</i>"}`,
    product.description ? `\n${esc(product.description)}` : "\n<i>Описания нет</i>",
  ].join("\n");

  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: "Название", callback_data: `edit:${product.id}:title` },
          { text: "Цена", callback_data: `edit:${product.id}:price` },
        ],
        // Скидка живёт здесь же, рядом с ценой: владелец ищет её там, где
        // принимает решение о цене, а не в отдельном разделе.
        [
          {
            text: product.oldPrice > product.price ? `Скидка −${Math.round((1 - product.price / product.oldPrice) * 100)}%` : "Скидка",
            callback_data: `edit:${product.id}:sale`,
          },
        ],
        [
          { text: "Фото", callback_data: `edit:${product.id}:photo` },
          { text: "Галерея", callback_data: `gallery:${product.id}` },
        ],
        [
          { text: "Бренд", callback_data: `edit:${product.id}:brand` },
          { text: "Категория", callback_data: `cat:${product.id}` },
        ],
        [
          { text: "Описание", callback_data: `edit:${product.id}:desc` },
          { text: "Варианты", callback_data: `variants:${product.id}` },
        ],
        [{ text: "Характеристики", callback_data: `specs:${product.id}` }],
        [
          {
            text: product.isActive ? "Скрыть с витрины" : "Вернуть на витрину",
            callback_data: `toggle:${product.id}`,
          },
          { text: "Удалить", callback_data: `del:${product.id}` },
        ],
        [
          { text: "Открыть в витрине", url: `${appUrl()}/?product=${product.id}` },
          { text: "‹ Товары", callback_data: "products:0" },
        ],
      ],
    },
  };
}

export function deleteConfirmScreen(product: Product): { text: string; keyboard: Keyboard } {
  return {
    text: [
      `<b>Удалить «${esc(product.title)}»?</b>`,
      "",
      "Товар исчезнет с витрины вместе с вариантами, характеристиками и фото в галерее.",
      "Заказы, где он был, останутся в истории.",
      "",
      "Если товар просто больше не продаётся — лучше скрыть: история и отзывы сохранятся.",
    ].join("\n"),
    keyboard: {
      inline_keyboard: [
        [{ text: "Да, удалить", callback_data: `delok:${product.id}` }],
        [{ text: "Нет, скрыть с витрины", callback_data: `toggle:${product.id}` }],
        [{ text: "‹ К товару", callback_data: `product:${product.id}` }],
      ],
    },
  };
}

// ─── Категории ─────────────────────────────────────────────────────────────

export function categoryPickScreen(productId: string, categories: Category[]): { text: string; keyboard: Keyboard } {
  const rows: InlineButton[][] = categories.map((c) => [
    { text: c.name, callback_data: `cat:${productId}:${c.id}` },
  ]);
  return {
    text: [
      "<b>Категория товара</b>",
      "",
      "От неё зависит, в каком разделе витрины покажется товар.",
    ].join("\n"),
    keyboard: {
      inline_keyboard: [
        ...rows,
        [{ text: "Новая категория", callback_data: "catnew" }],
        [{ text: "‹ К товару", callback_data: `product:${productId}` }],
      ],
    },
  };
}

// ─── Новый товар: пошаговый ввод ───────────────────────────────────────────

export type Draft = {
  title?: string;
  price?: number;
  categoryId?: string;
  categoryName?: string;
  brand?: string;
  description?: string;
  photoUrl?: string;
};

/** Что ещё не заполнено — по этому списку бот ведёт владельца дальше. */
export function draftMissing(draft: Draft): ("title" | "price" | "categoryId")[] {
  const missing: ("title" | "price" | "categoryId")[] = [];
  if (!draft.title) missing.push("title");
  if (!draft.price) missing.push("price");
  if (!draft.categoryId) missing.push("categoryId");
  return missing;
}

export function draftScreen(draft: Draft): { text: string; keyboard: Keyboard } {
  const missing = draftMissing(draft);
  const rows: InlineButton[][] = [];
  if (!draft.title) rows.push([{ text: "1. Название", callback_data: "add:title" }]);
  if (!draft.price) rows.push([{ text: "2. Цена", callback_data: "add:price" }]);
  if (!draft.categoryId) rows.push([{ text: "3. Категория", callback_data: "add:category" }]);
  rows.push([
    { text: draft.brand ? `Бренд: ${draft.brand}` : "Бренд (необязательно)", callback_data: "add:brand" },
  ]);
  rows.push([
    {
      text: draft.description ? "Описание ✓" : "Описание (необязательно)",
      callback_data: "add:desc",
    },
  ]);
  rows.push([{ text: draft.photoUrl ? "Фото ✓" : "Фото (необязательно)", callback_data: "add:photo" }]);
  if (missing.length === 0) {
    rows.push([{ text: "Создать товар", callback_data: "add:create" }]);
  }
  rows.push([{ text: "‹ Отмена", callback_data: "products:0" }]);

  const lines = [
    "<b>Новый товар</b>",
    "",
    `Название: ${draft.title ? esc(draft.title) : "<i>—</i>"}`,
    `Цена: ${draft.price ? money(draft.price) : "<i>—</i>"}`,
    `Категория: ${draft.categoryName ? esc(draft.categoryName) : "<i>—</i>"}`,
    `Бренд: ${draft.brand ? esc(draft.brand) : "<i>—</i>"}`,
    `Описание: ${draft.description ? `${esc(draft.description.slice(0, 80))}…` : "<i>—</i>"}`,
    `Фото: ${draft.photoUrl ? "добавлено" : "<i>—</i>"}`,
    "",
    missing.length
      ? "<i>Заполните название, цену и категорию — остальное по желанию.</i>"
      : "<i>Всё готово. Можно создавать.</i>",
  ];

  return { text: lines.join("\n"), keyboard: { inline_keyboard: rows } };
}

export function draftFieldPrompt(field: string, categories: Category[] = []): { text: string; keyboard: Keyboard } {
  const cancel: Keyboard = { inline_keyboard: [[{ text: "‹ Отмена", callback_data: "add:new" }]] };
  switch (field) {
    case "title":
      return {
        text: [
          "<b>Название товара</b>",
          "",
          "Пришлите название одним сообщением — как его увидит покупатель.",
          `Например: <code>iPhone 16 Pro 256 ГБ</code>. До ${LIMIT_TITLE} символов.`,
        ].join("\n"),
        keyboard: cancel,
      };
    case "price":
      return {
        text: [
          "<b>Цена</b>",
          "",
          "Пришлите цену в рублях — целое число.",
          "Можно с пробелами: <code>89 990</code>. Копейки система считает сама.",
        ].join("\n"),
        keyboard: cancel,
      };
    case "category":
      return {
        text: "<b>Категория</b>\n\nВыберите раздел витрины:",
        keyboard: {
          inline_keyboard: [
            ...categories.map((c) => [{ text: c.name, callback_data: `add:cat:${c.id}` }]),
            [{ text: "Новая категория", callback_data: "catnew" }],
            [{ text: "‹ Отмена", callback_data: "add:new" }],
          ],
        },
      };
    case "brand":
      return {
        text: [
          "<b>Бренд</b>",
          "",
          "Пришлите название бренда одним словом: <code>Apple</code>, <code>Samsung</code>, <code>Dyson</code>.",
          "По бренду покупатели фильтруют каталог. Необязательно — можно пропустить.",
        ].join("\n"),
        keyboard: { inline_keyboard: [[{ text: "Пропустить", callback_data: "add:new" }]] },
      };
    case "desc":
      return {
        text: [
          "<b>Описание</b>",
          "",
          "Пришлите текст одним сообщением: что важно знать покупателю.",
          `До ${LIMIT_DESCRIPTION} символов. Необязательно.`,
        ].join("\n"),
        keyboard: { inline_keyboard: [[{ text: "Пропустить", callback_data: "add:new" }]] },
      };
    case "photo":
      return {
        text: [
          "<b>Фото товара</b>",
          "",
          "Пришлите фото одним сообщением — jpg или png, до 8 МБ.",
          "Оно станет обложкой карточки. Дополнительные кадры добавим в разделе «Галерея».",
        ].join("\n"),
        keyboard: { inline_keyboard: [[{ text: "Пропустить", callback_data: "add:new" }]] },
      };
    case "gallery":
      return {
        text: [
          "<b>Кадр галереи</b>",
          "",
          "Пришлите фото или видео — оно добавится к карточке после обложки.",
          "Фото: jpg/png до 8 МБ. Видео: пришлите ссылку (mp4) — файл целиком не принимаем.",
        ].join("\n"),
        keyboard: { inline_keyboard: [[{ text: "‹ Отмена", callback_data: "gallery:back" }]] },
      };
    default:
      return { text: "Пришлите значение одним сообщением.", keyboard: cancel };
  }
}

export function createdScreen(product: Product, drafts: { variants: number }): { text: string; keyboard: Keyboard } {
  return {
    text: [
      "<b>Товар создан</b>",
      "",
      `«${esc(product.title)}» — ${money(product.price)}`,
      product.isActive ? "Уже на витрине." : "Скрыт с витрины.",
      drafts.variants > 0 ? `Вариантов: ${drafts.variants}.` : "",
      "",
      "Дальше можно добавить варианты (память, цвет) и характеристики — от них зависят фильтры витрины.",
    ]
      .filter(Boolean)
      .join("\n"),
    keyboard: {
      inline_keyboard: [
        [
          { text: "Варианты", callback_data: `variants:${product.id}` },
          { text: "Характеристики", callback_data: `specs:${product.id}` },
        ],
        [
          { text: "Открыть карточку", callback_data: `product:${product.id}` },
          { text: "‹ Товары", callback_data: "products:0" },
        ],
      ],
    },
  };
}

// ─── Варианты ──────────────────────────────────────────────────────────────

export function variantsScreen(
  product: Product,
  variants: { id: string; label: string; kind: string; extra: number }[],
): { text: string; keyboard: Keyboard } {
  const lines = variants.length
    ? variants.map((v, i) => {
        const sign = v.extra === 0 ? "без надбавки" : `${v.extra > 0 ? "+" : "−"}${money(Math.abs(v.extra))}`;
        return `${i + 1}. ${esc(v.label)} — ${sign}`;
      })
    : ["<i>Вариантов нет: покупатель видит только базовую цену.</i>"];

  const removeRows: InlineButton[][] = variants.slice(0, 6).map((v, i) => [
    { text: `Удалить ${i + 1}: ${v.label}`.slice(0, 60), callback_data: `vardel:${product.id}:${v.id}` },
  ]);

  return {
    text: [
      `<b>Варианты</b> — ${esc(product.title)}`,
      `Базовая цена: ${money(product.price)}`,
      "",
      ...lines,
      "",
      "<i>Пришлите новые варианты одним сообщением, каждый с новой строки:</i>",
      "<code>128 ГБ -8000</code>",
      "<code>256 ГБ</code>",
      "<code>Чёрный титан</code>",
      "",
      "Число со знаком — надбавка к цене. Без числа — цена не меняется.",
    ].join("\n"),
    keyboard: {
      inline_keyboard: [
        [{ text: "Добавить варианты", callback_data: `varadd:${product.id}` }],
        ...removeRows,
        [{ text: "‹ К товару", callback_data: `product:${product.id}` }],
      ],
    },
  };
}

export function variantsAskScreen(product: Product): { text: string; keyboard: Keyboard } {
  return {
    text: [
      "<b>Новые варианты</b>",
      "",
      "Пришлите одним сообщением, каждый вариант с новой строки.",
      "Надбавка к цене — числом со знаком: <code>512 ГБ +15000</code>, <code>128 ГБ -8000</code>.",
      "",
      "Цвет: <code>Чёрный титан</code> — цена не меняется.",
    ].join("\n"),
    keyboard: { inline_keyboard: [[{ text: "‹ Отмена", callback_data: `variants:${product.id}` }]] },
  };
}

// ─── Характеристики ────────────────────────────────────────────────────────

export function specsScreen(
  product: Product,
  specs: { group: string; name: string; value: string; unit: string }[],
): { text: string; keyboard: Keyboard } {
  const lines = specs.length
    ? specs.map((s, i) => `${i + 1}. ${esc(s.name)}: <b>${esc(s.value)}</b>${s.unit ? ` ${esc(s.unit)}` : ""}`)
    : ["<i>Характеристик нет: карточка покажет только описание.</i>"];

  const removeRows: InlineButton[][] = specs.slice(0, 8).map((s, i) => [
    { text: `Удалить ${i + 1}: ${s.name}`.slice(0, 60), callback_data: `specdel:${product.id}:${s.name}` },
  ]);

  return {
    text: [
      `<b>Характеристики</b> — ${esc(product.title)}`,
      "",
      ...lines,
      "",
      "<i>Пришлите новые одним сообщением, каждая с новой строки:</i>",
      "<code>Встроенная память: 256 ГБ</code>",
      "<code>Диагональ: 6,3 дюйма</code>",
      "<code>Материал: титан</code>",
      "",
      "Из этих строк витрина строит фильтры «память», «диагональ», «мощность».",
    ].join("\n"),
    keyboard: {
      inline_keyboard: [
        [{ text: "Добавить характеристики", callback_data: `specadd:${product.id}` }],
        ...removeRows,
        [{ text: "‹ К товару", callback_data: `product:${product.id}` }],
      ],
    },
  };
}

export function specsAskScreen(product: Product): { text: string; keyboard: Keyboard } {
  return {
    text: [
      "<b>Новые характеристики</b>",
      "",
      "Пришлите списком, каждая строка — <code>Название: значение</code>.",
      "Одинаковые названия обновляются, новые добавляются.",
      "",
      "<code>Оперативная память: 8 ГБ</code>",
      "<code>Частота: 120 Гц</code>",
    ].join("\n"),
    keyboard: { inline_keyboard: [[{ text: "‹ Отмена", callback_data: `specs:${product.id}` }]] },
  };
}

// ─── Галерея ───────────────────────────────────────────────────────────────

export function galleryScreen(product: Product, count: number): { text: string; keyboard: Keyboard } {
  return {
    text: [
      `<b>Галерея</b> — ${esc(product.title)}`,
      "",
      `Кадров в галерее: <b>${count}</b>`,
      "Обложка — первое фото карточки, она меняется в разделе «Фото».",
      "",
      "Пришлите фото — добавится следующим кадром.",
      "Видео: пришлите ссылку на mp4 — она встроится плеером.",
    ].join("\n"),
    keyboard: {
      inline_keyboard: [
        [{ text: "Добавить фото", callback_data: `galadd:${product.id}` }],
        [{ text: "‹ К товару", callback_data: `product:${product.id}` }],
      ],
    },
  };
}

// ─── Покупатели и бонусы ───────────────────────────────────────────────────

export function customersScreen(customers: CustomerSummary[]): { text: string; keyboard: Keyboard } {
  if (customers.length === 0) {
    return {
      text: "<b>Покупатели</b>\n\n<i>Пока никто не оформлял заказ.</i>",
      keyboard: { inline_keyboard: [[{ text: "‹ Меню", callback_data: "menu" }]] },
    };
  }
  const lines = customers.map((c, i) => {
    const name = c.firstName || (c.username ? `@${c.username}` : "Без имени");
    const orders = c.ordersCount ? ` · заказов ${c.ordersCount}` : "";
    return `${i + 1}. ${esc(name)} — ${money(c.bonusBalance)}${orders}`;
  });
  return {
    text: [
      "<b>Покупатели</b> — последние " + customers.length,
      "",
      ...lines,
      "",
      "<i>Нажмите номер, чтобы открыть карточку: бонусы и контакт.</i>",
    ].join("\n"),
    keyboard: {
      inline_keyboard: [
        customers.slice(0, 10).map((c, i) => ({ text: String(i + 1), callback_data: `cust:${c.tgUserId}` })),
        [{ text: "‹ Меню", callback_data: "menu" }],
      ],
    },
  };
}

export function customerScreen(customer: CustomerSummary | null, orders: number): { text: string; keyboard: Keyboard } {
  if (!customer) {
    return {
      text: "<b>Покупатель не найден</b>\n\n<i>Возможно, профиль удалён.</i>",
      keyboard: { inline_keyboard: [[{ text: "‹ Покупатели", callback_data: "customers" }]] },
    };
  }
  const name = customer.firstName || (customer.username ? `@${customer.username}` : "Без имени");
  return {
    text: [
      `<b>${esc(name)}</b>`,
      customer.username ? `@${esc(customer.username)}` : "",
      `Telegram ID: <code>${esc(customer.tgUserId)}</code>`,
      customer.phone ? `Телефон: ${esc(customer.phone)}` : "Телефон: <i>не указан</i>",
      "",
      `Бонусы: <b>${money(customer.bonusBalance)}</b> · заказов: ${orders}`,
      customer.referralCode ? `Реферальный код: <code>${esc(customer.referralCode)}</code>` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    keyboard: {
      inline_keyboard: [
        [
          { text: "Начислить бонусы", callback_data: `bonus:${customer.tgUserId}` },
          { text: "Написать", url: `tg://user?id=${customer.tgUserId}` },
        ],
        [{ text: "‹ Покупатели", callback_data: "customers" }],
      ],
    },
  };
}

export function bonusAskScreen(tgUserId: string, balance: number): { text: string; keyboard: Keyboard } {
  return {
    text: [
      "<b>Начислить бонусы</b>",
      "",
      `Текущий баланс: ${money(balance)}`,
      "",
      "Пришлите сумму в рублях: <code>500</code> — начислить, <code>-200</code> — списать.",
      "Списать больше баланса нельзя.",
    ].join("\n"),
    keyboard: { inline_keyboard: [[{ text: "‹ Отмена", callback_data: `cust:${tgUserId}` }]] },
  };
}

// ─── Статистика ────────────────────────────────────────────────────────────

export function statsScreen(input: {
  orders: number;
  revenue: number;
  newOrders: number;
  products: number;
  activeProducts: number;
  customers: number;
  bonusIssued: number;
}): { text: string; keyboard: Keyboard } {
  return {
    text: [
      "<b>Сводка магазина</b>",
      "",
      `Заказов: <b>${input.orders}</b> (новых ${input.newOrders})`,
      `Выручка по выполненным: <b>${money(input.revenue)}</b>`,
      `Средний чек: <b>${input.orders ? money(Math.round(input.revenue / Math.max(1, input.orders))) : "—"}</b>`,
      "",
      `Товаров: ${input.products}, на витрине ${input.activeProducts}`,
      `Покупателей: ${input.customers}`,
      `Бонусов начислено: ${money(input.bonusIssued)}`,
    ].join("\n"),
    keyboard: {
      inline_keyboard: [
        [
          { text: "Заказы", callback_data: "orders:all" },
          { text: "Товары", callback_data: "products:0" },
        ],
        [
          { text: "Покупатели", callback_data: "customers" },
          { text: "‹ Меню", callback_data: "menu" },
        ],
      ],
    },
  };
}

// ─── Карточка заказа (расширенная) ─────────────────────────────────────────

export function orderAdminScreen(order: AdminOrder, items: { title: string; variant: string; price: number; quantity: number }[]): {
  text: string;
  keyboard: Keyboard;
} {
  const who = order.firstName ? esc(order.firstName) : "Гость";
  const handle = order.username ? ` @${esc(order.username)}` : "";
  const lines = items.length
    ? items.map((i) => `· ${esc(i.title)}${i.variant ? ` (${esc(i.variant)})` : ""} × ${i.quantity} — ${money(i.price * i.quantity)}`)
    : [`<i>Позиции не записаны (заявка из старой витрины)</i>`];

  const next = nextDeliveryStep(order.deliveryStatus);
  const text = [
    `<b>Заказ ${esc(order.id)}</b>`,
    `Сумма: <b>${money(order.total)}</b>`,
    order.bonusUsed > 0 ? `Списано бонусами: ${money(order.bonusUsed)}` : "",
    order.bonusEarned > 0 ? `Начислено бонусов: ${money(order.bonusEarned)}` : "",
    "",
    ...lines,
    "",
    `Клиент: ${who}${handle}`,
    `Telegram ID: <code>${esc(order.tgUserId ?? "—")}</code>`,
    order.contactPhone ? `Телефон: <b>${esc(order.contactPhone)}</b>` : "Телефон: <i>не указан</i>",
    `Создан: ${shortDate(order.createdAt)}`,
    order.comment ? `Комментарий: <i>${esc(order.comment)}</i>` : "",
    "",
    `<b>Статус:</b> ${deliveryLabel(order.deliveryStatus)}`,
    order.trackNumber
      ? `Трек-номер: <code>${esc(order.trackNumber)}</code>`
      : trackAllowed(order.deliveryStatus)
        ? "Трек-номер не указан"
        : "<i>Трек-номер появится после отправки</i>",
    paymentLine(order.deliveryStatus),
  ]
    .filter(Boolean)
    .join("\n");

  // Кнопки повторяют путь заказа: подтвердить → оплата получена → отправлено → трек.
  // «Готов к выдаче» не навязываем (нужен для ПВЗ), но оставляем как вариант.
  const deliveryRows: InlineButton[][] = [];
  if (next) {
    deliveryRows.push([
      { text: nextActionLabel(order.deliveryStatus, next), callback_data: `delivery:${order.id}:${next}` },
    ]);
  }
  const manual: InlineButton[] = [];
  if (order.deliveryStatus !== "cancelled" && order.deliveryStatus !== "pickup" && next !== "pickup") {
    manual.push({ text: "Готов к выдаче", callback_data: `delivery:${order.id}:pickup` });
  }
  if (!trackAllowed(order.deliveryStatus)) {
    manual.push({ text: "Трек — после отправки", callback_data: `track:${order.id}` });
  } else if (!order.trackNumber) {
    manual.push({ text: "Добавить трек", callback_data: `track:${order.id}` });
  }
  if (manual.length) deliveryRows.push(manual);

  return {
    text,
    keyboard: {
      inline_keyboard: [
        ...deliveryRows,
        [
          { text: "Трек-номер", callback_data: `track:${order.id}` },
          { text: "Комментарий", callback_data: `ocomment:${order.id}` },
        ],
        [
          order.deliveryStatus === "cancelled"
            ? { text: "Вернуть в работу", callback_data: `delivery:${order.id}:packing` }
            : { text: "Отменить заказ", callback_data: `delivery:${order.id}:cancelled` },
        ],
        [
          { text: "Написать клиенту", url: `tg://user?id=${order.tgUserId ?? 0}` },
          { text: "‹ Заказы", callback_data: `orders:${order.status}` },
        ],
      ],
    },
  };
}

/**
 * Подпись кнопки перехода: владельцу важно действие, а не название статуса.
 * «Оплата получена» понятнее, чем «Ожидает отправки».
 */
export function nextActionLabel(current: string, next: string): string {
  if (current === "cancelled") return "Вернуть в работу";
  if (next === "confirmed") return "Подтвердить заказ";
  if (next === "paid") return "Оплата получена";
  if (next === "shipped") return "Отправлено";
  if (next === "done") return "Получено";
  return `Дальше: ${deliveryLabel(next)}`;
}

/** Строка про оплату в карточке заказа: что делать владельцу прямо сейчас. */
export function paymentLine(status: string): string {
  if (status === "new") return "Оплата: <i>после подтверждения заказа</i>";
  if (status === "confirmed") return "Оплата: <b>ожидается</b> — нажмите «Оплата получена»";
  if (status === "cancelled") return "Оплата: —";
  return "Оплата: <b>получена</b>";
}

/** Фильтр заявок в панели: CRM-статус + доставка, чтобы видеть «в работе». */
export const ORDER_FILTERS: { key: string; label: string; status: OrderStatus }[] = [
  { key: "new", label: "Новые", status: "new" },
  { key: "contacted", label: "В работе", status: "contacted" },
  { key: "done", label: "Выполнены", status: "done" },
  { key: "cancelled", label: "Отменены", status: "cancelled" },
];

// ─── Оплата: реквизиты и ссылка ─────────────────────────────────────────────

/**
 * Экран «Оплата». Владелец видит, что уже настроено, и может изменить любую
 * строку. Пока реквизитов нет — клиент не получит, куда платить, поэтому
 * экран подсказывает, что именно нужно минимум (реквизиты или ссылка).
 */
export function paymentScreen(settings: ShopSettings): { text: string; keyboard: Keyboard } {
  const has = Boolean(settings.payment_details || settings.payment_link);
  const lines = [
    "<b>Оплата</b>",
    has
      ? "Клиент получает реквизиты и кнопку оплаты вместе с подтверждением заказа."
      : "Пока не настроено: клиент не узнает, куда платить. Заполните реквизиты или ссылку.",
    "",
  ];
  for (const def of SETTING_DEFS) {
    const value = settings[def.key];
    lines.push(`<b>${def.label}:</b> ${value ? esc(value) : "<i>не задано</i>"}`);
  }
  // Текст должен совпадать с тем, что реально делает бот: стирает «-», а не пустое
  // сообщение — Telegram не даёт отправить пустую строку.
  lines.push("", "<i>Нажмите строку, чтобы изменить. Пришлите «-», чтобы стереть значение.</i>");

  // По две кнопки в ряд: четыре пункта не растягивают сообщение.
  const rows: InlineButton[][] = [
    [
      { text: "Реквизиты", callback_data: "payset:payment_details" },
      { text: "Ссылка", callback_data: "payset:payment_link" },
    ],
    [
      { text: "Приписка", callback_data: "payset:payment_note" },
      { text: "Телефон", callback_data: "payset:shop_phone" },
    ],
    [{ text: "‹ Меню", callback_data: "menu" }],
  ];
  return { text: lines.join("\n"), keyboard: { inline_keyboard: rows } };
}

/** Подсказка для ввода одной настройки: что это, пример, как стереть. */
export function paymentPromptScreen(key: string): { text: string; keyboard: Keyboard } {
  const def = SETTING_DEFS.find((item) => item.key === key);
  const label = def?.label ?? "Значение";
  return {
    text: [
      `<b>${esc(label)}</b>`,
      "",
      def?.hint ?? "",
      "",
      `<i>Например:</i> <code>${esc(def?.example ?? "")}</code>`,
      def?.key === "payment_link" ? "Можно прислать без https:// — адрес допишется сам." : "",
      "",
      "Пришлите текст одним сообщением. Чтобы стереть — отправьте «-».",
    ]
      .filter(Boolean)
      .join("\n"),
    keyboard: { inline_keyboard: [[{ text: "‹ Назад", callback_data: "pay" }]] },
  };
}

// ─── Массовые действия с товарами ───────────────────────────────────────────

/**
 * Экран массовых действий. Два сценария владельца:
 *   1) «скрыть всё из категории на время» / «вернуть на витрину»;
 *   2) «поднять цены на 5% в категории».
 * Поэтому выбор один — категория, а действие кнопкой. Категории показываем
 * с количеством товаров, чтобы не гадать, где что.
 */
export function bulkScreen(categories: { id: string; name: string; productCount: number }[]): {
  text: string;
  keyboard: Keyboard;
} {
  const rows: InlineButton[][] = categories.map((category) => [
    { text: `${category.name} (${category.productCount})`, callback_data: `bulkcat:${category.id}` },
  ]);
  return {
    text: [
      "<b>Массовые действия</b>",
      "",
      "Выберите категорию — дальше скроете/покажете все её товары или измените цены.",
      "",
      "<i>Действие применяется ко всем товарам категории сразу.</i>",
    ].join("\n"),
    keyboard: { inline_keyboard: [...rows, [{ text: "‹ Меню", callback_data: "menu" }]] },
  };
}

/** Экран действий для выбранной категории: скрыть/показать, цена, назад. */
export function bulkCategoryScreen(
  category: { id: string; name: string },
  counts: { total: number; active: number; hidden: number },
): { text: string; keyboard: Keyboard } {
  return {
    text: [
      `<b>${esc(category.name)}</b>`,
      "",
      `Товаров: <b>${counts.total}</b> — на витрине ${counts.active}, скрыто ${counts.hidden}`,
      "",
      "<b>Цены</b> меняются в процентах: «+5» поднимет, «-10» снизит.",
      "<b>Скрыть</b> убирает товары с витрины, но не удаляет их.",
    ].join("\n"),
    keyboard: {
      inline_keyboard: [
        [
          { text: "Скрыть все", callback_data: `bulk:hide:${category.id}` },
          { text: "Показать все", callback_data: `bulk:show:${category.id}` },
        ],
        [{ text: "Изменить цены", callback_data: `bulk:price:${category.id}` }],
        [{ text: "‹ Категории", callback_data: "bulk" }],
      ],
    },
  };
}

/**
 * Разбор введённого процента: «+5», «5», «-10», «+5%». Возвращает null, если
 * это не процент — тогда панель просит повторить, а не молча меняет цены.
 * Допустимый диапазон ±50%: больше похоже на опечатку и рушит каталог.
 */
export function parsePricePercent(raw: string): number | null {
  const value = raw.trim().replace(/[%\s]/g, "").replace(",", ".");
  if (!/^[+-]?\d{1,2}(\.\d)?$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return null;
  if (Math.abs(number) > 50) return null;
  return number;
}

/** Текст подтверждения перед применением массового действия. */
export function bulkConfirmText(kind: string, categoryName: string, count: number, extra = ""): string {
  if (kind === "hide") return `Скрыть <b>${count}</b> товаров в «${esc(categoryName)}»? Они исчезнут с витрины.`;
  if (kind === "show") return `Вернуть на витрину <b>${count}</b> товаров в «${esc(categoryName)}»?`;
  return `Изменить цены на <b>${extra}</b> у <b>${count}</b> товаров в «${esc(categoryName)}»?`;
}

// ─── Очереди заказов и поиск ────────────────────────────────────────────────

/**
 * Очередь заказов по статусу доставки: «ждут оплаты» и «ждут отправки».
 * Сверху — то, что ждёт дольше всех, и сумма к оплате: с этим владелец идёт
 * сверять перевод. Пять первых заказов получают кнопки, остальные видны текстом —
 * иначе клавиатура на 20 кнопок закрывает пол-экрана.
 */
export function queueScreen(orders: AdminOrder[], status: string): { text: string; keyboard: Keyboard } {
  const title = status === "paid" ? "Ждут отправки" : "Ждут оплаты";
  const hint =
    status === "paid"
      ? "Оплата получена — соберите и передайте в доставку, потом нажмите «Отправлено»."
      : "Подтвердили заказ, но оплата не отмечена. Клиент получил реквизиты.";

  if (orders.length === 0) {
    return {
      text: [`<b>${title}</b>`, "", `<i>Пусто — ${status === "paid" ? "всё отправлено." : "все оплаты отмечены."}</i>`].join(
        "\n",
      ),
      keyboard: { inline_keyboard: [[{ text: "‹ Меню", callback_data: "menu" }]] },
    };
  }

  const lines = orders.map((order, index) => {
    const who = order.firstName ? esc(order.firstName) : "Гость";
    const phone = order.contactPhone ? ` · ${esc(order.contactPhone)}` : "";
    return [
      `${index + 1}. <b>${esc(order.productTitle)}</b> — ${money(order.total || order.productPrice)}`,
      `   ${who}${phone} · ${shortDate(order.createdAt)}`,
      `   <i>${esc(deliveryLabel(order.deliveryStatus))}</i>`,
    ].join("\n");
  });

  const buttons = orders.slice(0, 5).map((order, index) => ({
    text: `${index + 1} · ${money(order.total || order.productPrice)}`,
    callback_data: `order:${order.id}`,
  }));

  return {
    text: [`<b>${title}</b> — ${orders.length}`, "", hint, "", lines.join("\n\n")].join("\n"),
    keyboard: {
      inline_keyboard: [
        ...(buttons.length ? [buttons] : []),
        [
          { text: "Найти заказ", callback_data: "ofind" },
          { text: "‹ Меню", callback_data: "menu" },
        ],
      ],
    },
  };
}

/** Приглашение ввести номер заказа, телефон или имя клиента. */
export function orderSearchPromptScreen(): { text: string; keyboard: Keyboard } {
  return {
    text: [
      "<b>Поиск заказа</b>",
      "",
      "Пришлите номер заказа, телефон клиента или его имя.",
      "",
      "<i>Номер можно ввести не полностью — хватит последних 4–5 символов.</i>",
      "<i>Например: </i><code>k3f9</code><i> или </i><code>+7999</code>",
    ].join("\n"),
    keyboard: { inline_keyboard: [[{ text: "‹ Меню", callback_data: "menu" }]] },
  };
}

/** Результат поиска: найденные заказы кнопками либо честное «ничего не нашлось». */
export function orderSearchResultScreen(query: string, orders: AdminOrder[]): { text: string; keyboard: Keyboard } {
  if (orders.length === 0) {
    return {
      text: [
        `<b>Поиск:</b> ${esc(query)}`,
        "",
        "<i>Ничего не нашлось. Проверьте номер или пришлите телефон целиком.</i>",
      ].join("\n"),
      keyboard: {
        inline_keyboard: [
          [{ text: "Искать ещё", callback_data: "ofind" }],
          [{ text: "‹ Меню", callback_data: "menu" }],
        ],
      },
    };
  }
  const lines = orders.map((order, index) => {
    const who = order.firstName ? esc(order.firstName) : "Гость";
    return [
      `${index + 1}. <b>${esc(order.productTitle)}</b> — ${money(order.total || order.productPrice)}`,
      `   №${esc(order.id)} · ${who} · ${esc(deliveryLabel(order.deliveryStatus))}`,
      `   ${shortDate(order.createdAt)}`,
    ].join("\n");
  });
  return {
    text: [`<b>Поиск:</b> ${esc(query)} — найдено ${orders.length}`, "", lines.join("\n\n")].join("\n"),
    keyboard: {
      inline_keyboard: [
        orders.slice(0, 5).map((order) => ({ text: `№${order.id.slice(-4)} · ${money(order.total)}`, callback_data: `order:${order.id}` })),
        [{ text: "Искать ещё", callback_data: "ofind" }],
        [{ text: "‹ Меню", callback_data: "menu" }],
      ],
    },
  };
}

/** Приглашение ввести процент для изменения цен категории. */
export function bulkPricePromptScreen(category: { id: string; name: string }): { text: string; keyboard: Keyboard } {
  return {
    text: [
      `<b>Цены · ${esc(category.name)}</b>`,
      "",
      "Пришлите изменение в процентах:",
      "<code>+5</code> — поднять на 5%",
      "<code>-10</code> — снизить на 10%",
      "",
      "<i>Допустимо от −50% до +50%. Цена не опустится ниже 1 ₽.</i>",
      "<i>Надбавки вариантов не меняются.</i>",
    ].join("\n"),
    keyboard: {
      inline_keyboard: [
        [
          { text: "+5%", callback_data: `bulkdo:${category.id}:5` },
          { text: "+10%", callback_data: `bulkdo:${category.id}:10` },
        ],
        [{ text: "‹ Назад", callback_data: `bulkcat:${category.id}` }],
      ],
    },
  };
}

/** Итог массового изменения цен: сколько изменилось и на сколько. */
export function bulkPriceResultText(categoryName: string, percent: number, affected: number, total: number): string {
  const sign = percent > 0 ? "+" : "";
  return [
    `<b>Цены обновлены</b> — ${esc(categoryName)}`,
    "",
    `Изменено товаров: <b>${affected}</b> из ${total} (${sign}${percent}%)`,
    affected === 0 ? "<i>Цены уже были такими — ничего не поменялось.</i>" : "",
  ]
    .filter(Boolean)
    .join("\n");
}
