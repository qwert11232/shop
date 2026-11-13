import { isOrderStatus, orderStatusLabel, type AdminOrder, type OrderStatus, type Product } from "./repo";
import { appUrl } from "./bot-access";
import type { InlineButton, Keyboard } from "./bot-api";
import { deliveryLabel } from "./shop";

/**
 * Экраны админ-бота: чистая функция «данные → текст + клавиатура», без сети.
 * Поэтому их можно проверять без Telegram (npm run check:bot).
 *
 * Разметка — HTML Bot API: <b>, <i>, <code>. Пользовательские значения
 * экранируются, иначе название товара с «<» ломает сообщение.
 */
export type Screen = { text: string; keyboard?: Keyboard; parseMode?: "HTML" };

export { orderStatusLabel };

export function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function money(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;
}

/**
 * Кнопка витрины. Именно `web_app`: мини-апп внутри Telegram знает, кто
 * покупатель, а обычная ссылка открывает сайт без данных — там гость.
 */
export function appButton(text = "Открыть витрину"): InlineButton {
  return { text, web_app: { url: appUrl() } };
}

function openApp(): Keyboard {
  return { inline_keyboard: [[appButton()]] };
}

/** Часы работы магазина в человеческом виде: «05.11, 14:32» по Москве. */
export function shortDate(raw: string): string {
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Главный экран панели.
 *
 * Задача экрана — ответить «что делать сейчас», а не показать всё подряд.
 * Поэтому сверху три очереди работы: заказы ждут подтверждения, оплаты, отправки.
 * Кнопки очередей неактивны, когда пусто (Telegram не даёт «серые» кнопки,
 * поэтому пишем «0» прямо в названии и убираем переход — нажатие всё равно
 * откроет пустой список, и это нормально). Ниже — товары и служебные разделы.
 */
export function menuScreen(stats: {
  newOrders: number;
  awaitingPayment: number;
  awaitingShipment: number;
  activeProducts: number;
  revenueDone: number;
  paymentConfigured: boolean;
}): Screen {
  const queue: string[] = [];
  if (stats.newOrders > 0) queue.push(`Подтвердить: <b>${stats.newOrders}</b>`);
  if (stats.awaitingPayment > 0) queue.push(`Ждут оплаты: <b>${stats.awaitingPayment}</b>`);
  if (stats.awaitingShipment > 0) queue.push(`Отправить: <b>${stats.awaitingShipment}</b>`);

  const text = [
    "<b>ТЕХНОЛАБ · панель</b>",
    "",
    queue.length ? queue.join("\n") : "<i>Срочных дел нет — все заказы в работе.</i>",
    "",
    `Товаров в наличии: <b>${stats.activeProducts}</b>`,
    `Выручка по выполненным: <b>${money(stats.revenueDone)}</b>`,
    stats.paymentConfigured ? "" : "\n⚠️ <b>Оплата не настроена</b> — клиенту не придёт, куда платить.",
    "",
    "<i>/start — эта панель, /help — что умеет бот</i>",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const keyboard: InlineButton[][] = [
    [{ text: `Ждут подтверждения (${stats.newOrders})`, callback_data: "orders:new" }],
    [
      { text: `Ждут оплаты (${stats.awaitingPayment})`, callback_data: "queue:confirmed" },
      { text: `Отправить (${stats.awaitingShipment})`, callback_data: "queue:paid" },
    ],
    [
      { text: "Товары", callback_data: "products:0" },
      { text: "Добавить товар", callback_data: "add:new" },
    ],
    [{ text: "Найти заказ", callback_data: "ofind" }],
    [
      { text: "Покупатели", callback_data: "customers" },
      { text: "Сводка", callback_data: "stats" },
    ],
    [{ text: stats.paymentConfigured ? "Оплата и реквизиты" : "Настроить оплату", callback_data: "pay" }],
    [appButton()],
  ];

  return { text, keyboard: { inline_keyboard: keyboard } };
}

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "new", label: "Новые" },
  { key: "contacted", label: "На связи" },
  { key: "done", label: "Выполнены" },
  { key: "all", label: "Все" },
];

export function ordersScreen(orders: AdminOrder[], filter: string): Screen {
  const header =
    filter === "all"
      ? "<b>Заявки</b> — последние 10"
      : `<b>Заявки</b> — ${esc(
          STATUS_FILTERS.find((f) => f.key === filter)?.label.toLowerCase() ?? filter,
        )}`;

  const filters: InlineButton[][] = [
    STATUS_FILTERS.map((f) => ({
      text: f.key === filter ? `· ${f.label} ·` : f.label,
      callback_data: `orders:${f.key}`,
    })),
  ];

  if (orders.length === 0) {
    return {
      text: `${header}\n\n<i>Здесь пусто.</i>`,
      keyboard: { inline_keyboard: [...filters, [{ text: "‹ Меню", callback_data: "menu" }]] },
    };
  }

  const lines = orders.map((order, index) => {
    const who = order.firstName ? esc(order.firstName) : "Гость";
    const handle = order.username ? ` @${esc(order.username)}` : "";
    const comment = order.comment ? `\n   <i>${esc(order.comment)}</i>` : "";
    return [
      `${index + 1}. <b>${esc(order.productTitle)}</b> — ${money(order.productPrice)}`,
      `   ${who}${handle} · ${shortDate(order.createdAt)} · ${orderStatusLabel(order.status)}${comment}`,
    ].join("\n");
  });

  const detailButtons = orders
    .slice(0, 5)
    .map((order, index) => ({
      text: `${index + 1} — ${orderStatusLabel(order.status)}`,
      callback_data: `order:${order.id}`,
    }));

  return {
    text: `${header}\n\n${lines.join("\n\n")}`,
    keyboard: {
      inline_keyboard: [
        ...filters,
        ...(detailButtons.length ? [detailButtons] : []),
        [{ text: "‹ Меню", callback_data: "menu" }],
      ],
    },
  };
}

const NEXT_STATUS: Record<OrderStatus, OrderStatus[]> = {
  new: ["contacted", "cancelled"],
  contacted: ["done", "cancelled"],
  done: ["contacted"],
  cancelled: ["new"],
};

const STATUS_ACTION: Record<OrderStatus, string> = {
  new: "Вернуть в новые",
  contacted: "Взять в работу",
  done: "Завершить",
  cancelled: "Отменить",
};

/**
 * AppCompat заглушка: полная карточка заказа с доставкой и позициями живёт в
 * `bot-screens-admin.ts`. Здесь остаётся короткая версия для списков.
 */
export function orderCardScreen(order: AdminOrder): Screen {
  const who = order.firstName ? esc(order.firstName) : "Гость";
  const handle = order.username ? ` @${esc(order.username)}` : "";
  const tgId = order.tgUserId ? `\nID: <code>${esc(order.tgUserId)}</code>` : "";
  const delivery = order.deliveryStatus || "new";
  const text = [
    `<b>${esc(order.productTitle)}</b>`,
    `${money(order.total || order.productPrice)} · ${orderStatusLabel(order.status)}`,
    "",
    `Клиент: ${who}${handle}${tgId}`,
    `Создана: ${shortDate(order.createdAt)}`,
    order.comment ? `Комментарий: <i>${esc(order.comment)}</i>` : "",
    "",
    `<b>Доставка:</b> ${deliveryLabel(delivery)}`,
    order.trackNumber ? `Трек-номер: <code>${esc(order.trackNumber)}</code>` : "Трек-номер не указан",
    order.groupMessageId ? `Сообщение в группе: #${esc(order.groupMessageId)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const current: OrderStatus = isOrderStatus(order.status) ? order.status : "new";
  const actions: InlineButton[] = NEXT_STATUS[current].map((status) => ({
    text: STATUS_ACTION[status],
    callback_data: `status:${order.id}:${status}`,
  }));

  return {
    text,
    keyboard: {
      inline_keyboard: [
        actions.length ? actions : [],
        [
          { text: "‹ Заявки", callback_data: `orders:${order.status}` },
          { text: "Меню", callback_data: "menu" },
        ],
      ].filter((row) => row.length > 0),
    },
  };
}

/** Подсказка при вводе трек-номера. */
export function trackPromptScreen(order: AdminOrder): Screen {
  return {
    text: [
      `<b>Трек-номер заказа № ${esc(order.id)}</b>`,
      "",
      "Пришлите номер посылки одним сообщением — до 40 символов, латиница, цифры и дефис.",
      "Клиент увидит его в личном кабинете, в карточке заказа.",
    ].join("\n"),
    keyboard: {
      inline_keyboard: [[{ text: "‹ Отмена", callback_data: `order:${order.id}` }]],
    },
  };
}

/** Проверка формата трека: без пробелов, не длиннее 40 символов. */
export function normalizeTrack(raw: string): string | null {
  const value = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{4,40}$/.test(value)) return null;
  return value;
}

const PAGE_SIZE = 5;

export function productsScreen(products: Product[], page: number): Screen {
  const total = products.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const slice = products.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const header = `<b>Товары</b> — ${total} шт., стр. ${current + 1}/${pages}`;
  if (slice.length === 0) {
    return {
      text: `${header}\n\n<i>Товаров пока нет.</i>`,
      keyboard: { inline_keyboard: [[{ text: "‹ Меню", callback_data: "menu" }]] },
    };
  }

  const lines = slice.map((product, index) => {
    const hidden = product.isActive ? "" : " · <i>скрыт</i>";
    return `${current * PAGE_SIZE + index + 1}. ${esc(product.title)} — ${money(product.price)}${hidden}`;
  });

  const nav: InlineButton[] = [];
  if (current > 0) nav.push({ text: "‹ Назад", callback_data: `products:${current - 1}` });
  if (current < pages - 1) nav.push({ text: "Дальше ›", callback_data: `products:${current + 1}` });

  return {
    text: `${header}\n\n${lines.join("\n")}\n\n<i>Нажмите номер, чтобы открыть карточку.</i>`,
    keyboard: {
      inline_keyboard: [
        slice.map((product, index) => ({
          text: String(current * PAGE_SIZE + index + 1),
          callback_data: `product:${product.id}`,
        })),
        ...(nav.length ? [nav] : []),
        [{ text: "‹ Меню", callback_data: "menu" }],
      ],
    },
  };
}

export function productCardScreen(product: Product): Screen {
  const text = [
    `<b>${esc(product.title)}</b>`,
    `Цена: <b>${money(product.price)}</b>`,
    `Статус: ${product.isActive ? "в наличии" : "<i>скрыт с витрины</i>"}`,
    product.description ? `\n${esc(product.description)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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
          {
            text: product.isActive ? "Скрыть с витрины" : "Вернуть на витрину",
            callback_data: `toggle:${product.id}`,
          },
        ],
        [{ text: "‹ Товары", callback_data: "products:0" }],
      ],
    },
  };
}

/** Подсказка, когда бот ждёт значение: что именно и в каком формате. */
export function fieldPrompt(field: string, product?: Product): Screen {
  const back: Keyboard = {
    inline_keyboard: [[{ text: "‹ Отмена", callback_data: product ? `product:${product.id}` : "menu" }]],
  };
  switch (field) {
    case "price":
      return {
        text: "Пришлите новую цену в рублях — только целое число, например <code>89990</code>.",
        keyboard: back,
      };
    case "sale":
      return {
        text: [
          "<b>Скидка</b>",
          "",
          "Пришлите процент — например <code>10</code> или <code>10%</code>.",
          "Цена для клиента останется текущей, а рядом появится зачёркнутая старая.",
          "",
          "Можно прислать и старую цену: <code>109990</code> — тогда клиент увидит «было 109 990 ₽».",
          "<code>0</code> — снять скидку.",
          "",
          "<i>Скидка до 50%. В корзину и заказ попадает цена, которую видит клиент — скидка не может «потеряться».</i>",
        ].join("\n"),
        keyboard: back,
      };
    case "title":
      return { text: "Пришлите новое название товара — до 120 символов.", keyboard: back };
    case "photo":
      return {
        text: "Пришлите фото товара одним сообщением. Формат: jpg, png или webp, до 8 МБ.",
        keyboard: back,
      };
    default:
      return { text: "Пришлите значение.", keyboard: back };
  }
}

export function savedScreen(product: Product, message: string): Screen {
  return {
    text: `<b>Готово.</b> ${esc(message)}`,
    keyboard: {
      inline_keyboard: [
        [{ text: "К товару", callback_data: `product:${product.id}` }],
        [{ text: "‹ Меню", callback_data: "menu" }],
      ],
    },
  };
}

export function helpScreen(): Screen {
  const text = [
    "<b>Что умеет бот</b>",
    "",
    "<b>Товары</b>",
    "/new — добавить товар: название, цена, категория, бренд, описание, фото",
    "/products — список товаров; в карточке: цена, бренд, описание, фото, галерея,",
    "варианты (память, цвет), характеристики, скрыть или удалить",
    "/find — поиск товара по названию или бренду",
    "",
    "<b>Заказы</b>",
    "/orders — новые заявки. На главном экране три очереди: ждут подтверждения,",
    "ждут оплаты, отправить. В карточке — статус доставки, трек-номер,",
    "комментарий клиенту и кнопка «Написать»",
    "«Найти заказ» — поиск по номеру, телефону или имени клиента",
    "",
    "Путь заказа: клиент оформил → вы подтверждаете → клиент получает реквизиты →",
    "«Оплата получена» → «Отправлено» и трек-номер → «Получено».",
    "На каждый шаг клиенту приходит сообщение в личку.",
    "",
    "<b>Оплата</b>",
    "Кнопка «Настроить оплату» на главном экране: реквизиты, ссылка на оплату,",
    "приписка и телефон магазина. Клиент получает их вместе с подтверждением заказа.",
    "",
    "<b>Массовые действия</b>",
    "Товары → «Массовые действия»: скрыть или показать всю категорию,",
    "поднять или снизить цены категории на процент.",
    "",
    "<b>Покупатели</b>",
    "/customers — контакты, бонусный баланс, начисление и списание бонусов",
    "/stats — сводка: заказы, выручка, средний чек, бонусы",
    "",
    "<b>Бот один на двоих</b>",
    "Вам этот бот показывает панель. Обычный покупатель в том же боте видит",
    "свои заказы, корзину и бонусы: /orders, /cart, /bonus, /help.",
    "Доступ к панели — по ADMIN_TELEGRAM_IDS или ADMIN_TELEGRAM_USERNAMES.",
    "",
    "/id — мой Telegram ID",
    "/help — эта справка",
    "",
    "<i>Фото присылайте прямо в чат: бот сохранит его и поставит обложкой или кадром галереи.</i>",
  ].join("\n");
  return { text, keyboard: { inline_keyboard: [[{ text: "‹ Меню", callback_data: "menu" }]] } };
}

export function noAccessScreen(): Screen {
  return {
    text: [
      "Это бот магазина ТЕХНОЛАБ.",
      "",
      "Каталог и заявки открываются в приложении. Доступ к панели есть только у владельца магазина.",
    ].join("\n"),
    keyboard: openApp(),
  };
}

export function notConfiguredScreen(telegramId: number): Screen {
  return {
    text: [
      "<b>Доступ не настроен</b>",
      "",
      "На сервере не задан ни один администратор.",
      `Ваш ID: <code>${telegramId}</code>`,
      "",
      "Добавьте его в переменную <code>ADMIN_TELEGRAM_IDS</code> и перезапустите деплой.",
    ].join("\n"),
  };
}

export function errorScreen(reason: string): Screen {
  return {
    text: [
      "<b>Не удалось выполнить</b>",
      "",
      `<i>${esc(reason)}</i>`,
      "",
      "Если это про базу — проверьте DATABASE_URL и откройте /api/health.",
    ].join("\n"),
    keyboard: { inline_keyboard: [[{ text: "Повторить", callback_data: "menu" }]] },
  };
}
