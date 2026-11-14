import { appButton, esc, money, type Screen } from "./bot-screens";
import type { Keyboard, ReplyKeyboard } from "./bot-api";
import { DELIVERY_STEPS, deliveryLabel, deliveryStepIndex } from "./order-status";
import type { Cart, OrderSummary } from "./shop";

/**
 * Экраны бота для покупателя.
 *
 * Бот один на магазин: владелец ведёт в нём заказы, а покупатель — смотрит
 * свою корзину, заказы и бонусы. Разделение по Telegram ID происходит в
 * вебхуке (`isBotAdmin`), а здесь только тексты и кнопки — ни одного решения
 * о доступе.
 *
 * Тон отличается от админского: покупателю не нужны внутренние статусы CRM
 * и суммы в копейках. Он видит «Ожидает подтверждения», трек-номер и бонусы.
 */

/** Подвал клиентских экранов: витрина — главный путь к покупке. */
function shopKeyboard(extra: InlineRow[] = []): Keyboard {
  return { inline_keyboard: [...extra, [appButton()]] };
}

type InlineRow = { text: string; callback_data: string }[];

/**
 * Разделы покупателя — нижняя клавиатура, как в привычных ботах.
 *
 * Почему не инлайн: панель висит под полем ввода и остаётся на месте, пока
 * человек листает чат. Инлайн-кнопки уезжают вместе со старым сообщением, и
 * после двух-трёх действий меню приходится искать вверх.
 *
 * Тексты кнопок — это же и есть команды: нажатие приходит обычным сообщением.
 */
export const CLIENT_SECTIONS = {
  shop: "🛍 Витрина",
  orders: "📦 Мои заказы",
  cart: "🧺 Корзина",
  bonus: "🎁 Мои бонусы",
  help: "❓ Помощь",
} as const;

/**
 * Панель приходит ТОЛЬКО в личке. В группе нижняя клавиатура висела бы у всех
 * участников — покупательские разделы там ни к чему.
 */
export function clientReplyKeyboard(): ReplyKeyboard {
  return {
    keyboard: [
      [{ text: CLIENT_SECTIONS.shop }],
      [{ text: CLIENT_SECTIONS.orders }, { text: CLIENT_SECTIONS.cart }],
      [{ text: CLIENT_SECTIONS.bonus }, { text: CLIENT_SECTIONS.help }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Совпадает ли текст сообщения с кнопкой раздела. Регистр и emoji не важны. */
export function clientSectionOf(text: string): keyof typeof CLIENT_SECTIONS | null {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-zа-яё ]/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  const needle = norm(text);
  for (const [key, label] of Object.entries(CLIENT_SECTIONS)) {
    if (norm(label) === needle) return key as keyof typeof CLIENT_SECTIONS;
  }
  return null;
}

/** Шаги заказа одной строкой: «Оплачен → Отправлен → Получен». */
function stepsLine(status: string): string {
  const index = deliveryStepIndex(status);
  if (index < 0) return "";
  return DELIVERY_STEPS.map((step, i) => (i <= index ? `<b>${esc(step.label)}</b>` : esc(step.label))).join(" → ");
}

export function clientMenuScreen(input: {
  name: string;
  orders: number;
  cartCount: number;
  bonus: number;
}): Screen {
  const hello = input.name ? `${esc(input.name)}, здравствуйте!` : "Здравствуйте!";
  const text = [
    "<b>ТЕХНОЛАБ · магазин техники</b>",
    "",
    hello,
    "Здесь ваши заказы, корзина и бонусы. Выбрать и заказать товар можно",
    "в приложении — оно открывается кнопкой ниже.",
  ].join("\n");

  // Сводка — отдельными строками под текстом, чтобы цифры были на виду,
  // а не терялись в абзаце.
  const summary = [
    input.orders > 0 ? `📦 Заказов: <b>${input.orders}</b>` : "",
    input.cartCount > 0 ? `🧺 В корзине: <b>${input.cartCount}</b> поз.` : "",
    input.bonus > 0 ? `🎁 Бонусов: <b>${money(input.bonus)}</b>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    text: summary ? `${text}\n\n${summary}` : text,
    keyboard: shopKeyboard(),
  };
}

/** Экран перехода в витрину: кнопка запуска мини-аппа. */
export function clientShopScreen(): Screen {
  return {
    text: [
      "<b>Витрина</b>",
      "",
      "Каталог, сравнение и оформление заказа — в приложении.",
      "Оно откроется внутри Telegram: корзина и бонусы подхватятся сами.",
    ].join("\n"),
    keyboard: shopKeyboard(),
  };
}

export function clientOrdersScreen(orders: OrderSummary[]): Screen {
  if (orders.length === 0) {
    return {
      text: ["<b>Мои заказы</b>", "", "<i>Вы ещё ничего не заказывали.</i>"].join("\n"),
      keyboard: shopKeyboard(),
    };
  }

  const lines = orders.slice(0, 10).map((order, index) => {
    const items = order.items.map((i) => i.title).join(", ");
    const track = order.trackNumber ? `\n   Трек: <code>${esc(order.trackNumber)}</code>` : "";
    return [
      `${index + 1}. <b>${money(order.total)}</b> · ${esc(deliveryLabel(order.deliveryStatus))}`,
      `   ${esc(items.slice(0, 60))}${items.length > 60 ? "…" : ""}${track}`,
    ].join("\n");
  });

  return {
    text: [`<b>Мои заказы</b>`, "", lines.join("\n\n")].join("\n"),
    keyboard: shopKeyboard(),
  };
}

export function clientOrderCardScreen(order: OrderSummary): Screen {
  const items = order.items
    .map((i) => `· ${esc(i.title)}${i.variant ? ` (${esc(i.variant)})` : ""} × ${i.quantity} — ${money(i.price * i.quantity)}`)
    .join("\n");

  const steps = stepsLine(order.deliveryStatus);
  const text = [
    `<b>Заказ ${esc(order.id.slice(-6))}</b>`,
    esc(deliveryLabel(order.deliveryStatus)),
    steps ? `\n${steps}` : "",
    "",
    items || "<i>Позиции не сохранились</i>",
    "",
    `Итого: <b>${money(order.total)}</b>`,
    order.bonusUsed > 0 ? `Списано бонусами: ${money(order.bonusUsed)}` : "",
    order.bonusEarned > 0 ? `Начислено бонусов: ${money(order.bonusEarned)}` : "",
    order.trackNumber ? `Трек-номер: <code>${esc(order.trackNumber)}</code>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { text, keyboard: shopKeyboard([[{ text: "‹ Мои заказы", callback_data: "my:orders" }]]) };
}

export function clientCartScreen(cart: Cart): Screen {
  if (cart.lines.length === 0) {
    return {
      text: ["<b>Корзина</b>", "", "<i>Пока пусто.</i>", "", "Выберите товар в приложении — корзина появится здесь."].join("\n"),
      keyboard: shopKeyboard(),
    };
  }

  const lines = cart.lines.map(
    (line) =>
      `· ${esc(line.title)}${line.variantLabel ? ` (${esc(line.variantLabel)})` : ""} × ${line.quantity} — ${money(line.lineTotal)}`,
  );
  const text = [
    "<b>Корзина</b>",
    "",
    lines.join("\n"),
    "",
    cart.savings > 0 ? `Скидка: <b>−${money(cart.savings)}</b>` : "",
    `Итого: <b>${money(cart.total)}</b>`,
    "",
    "<i>Оформить заказ можно в приложении: там адрес, телефон и оплата.</i>",
  ]
    .filter(Boolean)
    .join("\n");

  return { text, keyboard: shopKeyboard() };
}

export function clientBonusScreen(input: { bonus: number; events: { amount: number; reason: string }[] }): Screen {
  const lines = input.events
    .slice(0, 8)
    .map((event) => `· ${event.amount > 0 ? "+" : "−"}${money(Math.abs(event.amount))} — ${esc(event.reason)}`);

  const text = [
    "<b>Бонусы</b>",
    "",
    `На счету: <b>${money(input.bonus)}</b>`,
    "",
    "Кешбэк 3% возвращается с каждой покупки. Списывать можно до 30% суммы заказа.",
    "",
    lines.length ? "<b>Последние операции</b>\n" + lines.join("\n") : "<i>Операций пока нет.</i>",
  ].join("\n");

  return { text, keyboard: shopKeyboard([[{ text: "‹ Назад", callback_data: "my:menu" }]]) };
}

export function clientHelpScreen(input: { phone: string }): Screen {
  const text = [
    "<b>Как мы работаем</b>",
    "",
    "1. Выбираете товар в приложении и оформляете заказ.",
    "2. Мы подтверждаем наличие и присылаем реквизиты для оплаты.",
    "3. Отправляем заказ и присылаем трек-номер — прямо в этот чат.",
    "",
    "Кешбэк 3% возвращается бонусами на следующую покупку.",
    "",
    input.phone ? `Вопрос по заказу: <b>${esc(input.phone)}</b>` : "",
    "На связи каждый день — ответим в этом чате.",
  ]
    .filter(Boolean)
    .join("\n");

  return { text, keyboard: shopKeyboard([[{ text: "‹ Назад", callback_data: "my:menu" }]]) };
}
