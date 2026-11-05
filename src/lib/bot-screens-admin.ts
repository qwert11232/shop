import type { AdminOrder, Category, OrderStatus, Product } from "./repo";
import type { CustomerSummary } from "./shop";
import type { InlineButton, Keyboard } from "./bot-api";
import { appUrl } from "./bot-access";
import { deliveryLabel, DELIVERY_STEPS } from "./shop";
import { esc, money, shortDate } from "./bot-screens";

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
          { text: "Добавить товар", callback_data: "add:new" },
          { text: "Найти", callback_data: "find:ask" },
        ],
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
    `Цена: <b>${money(product.price)}</b>`,
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
    `<b>Доставка:</b> ${deliveryLabel(order.deliveryStatus)}`,
    order.trackNumber ? `Трек-номер: <code>${esc(order.trackNumber)}</code>` : "Трек-номер не указан",
  ]
    .filter(Boolean)
    .join("\n");

  const deliveryRows: InlineButton[][] = [];
  if (next) {
    deliveryRows.push([{ text: `Дальше: ${deliveryLabel(next)}`, callback_data: `delivery:${order.id}:${next}` }]);
  }
  const others = DELIVERY_STEPS.filter((step) => step !== next && step !== order.deliveryStatus).map((step) => ({
    text: deliveryLabel(step),
    callback_data: `delivery:${order.id}:${step}`,
  }));
  if (others.length) deliveryRows.push(others);

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

export function nextDeliveryStep(current: string): string | null {
  if (current === "cancelled" || current === "done") return null;
  const index = DELIVERY_STEPS.indexOf(current as (typeof DELIVERY_STEPS)[number]);
  if (index === -1) return "packing";
  return DELIVERY_STEPS[Math.min(index + 1, DELIVERY_STEPS.length - 1)];
}

/** Фильтр заявок в панели: CRM-статус + доставка, чтобы видеть «в работе». */
export const ORDER_FILTERS: { key: string; label: string; status: OrderStatus }[] = [
  { key: "new", label: "Новые", status: "new" },
  { key: "contacted", label: "В работе", status: "contacted" },
  { key: "done", label: "Выполнены", status: "done" },
  { key: "cancelled", label: "Отменены", status: "cancelled" },
];
