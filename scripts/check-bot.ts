/**
 * Проверка админ-бота без Telegram и без сети: экраны, права доступа и смена
 * статусов на настоящей базе (SQLite-файл во временной папке).
 *
 * Запуск: npm run check:bot
 * Вызовы Bot API не выполняются: проверяется то, что определяет поведение —
 * тексты, кнопки, доступ и запись в БД.
 */
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`[check:bot] FAIL — ${message}`);
    process.exit(1);
  }
  console.log(`[check:bot] ok — ${message}`);
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "tekhnolab-bot-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "bot.db")}`;
  delete process.env.VERCEL;
  delete process.env.ADMIN_TELEGRAM_IDS;
  delete process.env.ADMIN_TELEGRAM_USERNAMES;
  delete process.env.OWNER_TELEGRAM_ID;

  const access = await import("../src/lib/bot-access");
  const screens = await import("../src/lib/bot-screens");
  const repo = await import("../src/lib/repo");
  const seed = await import("../src/lib/seed");

  // ── Доступ ────────────────────────────────────────────────────────────────
  assert(!access.adminsConfigured(), "без ADMIN_* доступ к панели закрыт");
  assert(!access.isBotAdmin({ id: 793536041, username: "nikita_tsk" }), "чужой ID по умолчанию не админ");
  assert(screens.notConfiguredScreen(42).text.includes("42"), "незаданный админ видит свой ID, а не молчание");

  process.env.ADMIN_TELEGRAM_IDS = "111, 222";
  process.env.ADMIN_TELEGRAM_USERNAMES = "@Owner_Shop";
  assert(access.isBotAdmin({ id: 111 }), "админ по ID");
  assert(access.isBotAdmin({ id: 999, username: "owner_shop" }), "админ по username без учёта регистра и @");
  assert(!access.isBotAdmin({ id: 999, username: "кто_то" }), "посторонний не админ");
  assert(!access.isBotAdmin(undefined), "пустой пользователь не админ");

  process.env.OWNER_TELEGRAM_ID = "333";
  assert(access.isBotAdmin({ id: 333 }), "OWNER_TELEGRAM_ID совместим с админкой");
  delete process.env.OWNER_TELEGRAM_ID;

  // ── Экраны ────────────────────────────────────────────────────────────────
  const menu = screens.menuScreen({ newOrders: 3, activeProducts: 17, revenueDone: 17998000 });
  assert(menu.text.includes("Новых заявок: <b>3</b>"), "меню показывает число новых заявок");
  // toLocaleString вставляет NBSP (U+00A0) — сравниваем, не завися от вида пробела.
  const flat = (value: string) => value.replace(/\u00a0|\u202f/g, " ");
  assert(flat(menu.text).includes("179 980 ₽"), "меню показывает выручку в рублях");
  const flatButtons = menu.keyboard!.inline_keyboard.flat();
  assert(flatButtons.some((b) => "callback_data" in b && b.callback_data === "orders:new"), "в меню есть кнопка заявок");
  assert(flatButtons.some((b) => "url" in b && b.url.startsWith("http")), "в меню есть кнопка витрины");

  assert(screens.esc('<b>x</b>') === "&lt;b&gt;x&lt;/b&gt;", "пользовательский текст экранируется");
  const emptyOrders = screens.ordersScreen([], "new");
  assert(emptyOrders.text.includes("Здесь пусто"), "пустой список заявок имеет осмысленный текст");

  // ── Данные и статусы ──────────────────────────────────────────────────────
  await seed.seedCatalog();
  const catalog = await repo.listCatalog();
  assert(catalog.length === 6, "каталог наполнен (6 категорий)");

  // Порядок в списке — «свежие сверху»; при одинаковом времени создания
  // его добивает название, поэтому страница бота стабильна между запросами.
  const adminList = await repo.listProductsAdmin();
  const product = adminList[0];
  const productsScreen = screens.productsScreen(adminList, 0);
  assert(productsScreen.text.includes(screens.esc(product.title)), "список товаров показывает товар");
  assert(
    screens.productsScreen(adminList, 0).text === productsScreen.text,
    "порядок товаров в боте не меняется от запроса к запросу",
  );
  const productCard = screens.productCardScreen(product);
  assert(productCard.text.includes("₽"), "карточка товара показывает цену");

  const order = await repo.createOrder({
    productId: product.id,
    comment: "проверка <script>",
    tgUserId: "555",
    firstName: "Иван",
    username: "ivan",
    groupMessageId: null,
  });
  assert((await repo.listOrdersByStatus("new")).length === 1, "новая заявка попадает в выборку статуса new");

  const orderCard = screens.orderCardScreen(
    (await repo.getOrderById(order.id))!,
  );
  assert(orderCard.text.includes("новая"), "в карточке заявки виден статус");
  assert(orderCard.text.includes("&lt;script&gt;"), "комментарий клиента экранируется (XSS в сообщении невозможен)");
  const statusButtons = orderCard.keyboard!.inline_keyboard.flat();
  assert(
    statusButtons.some((b) => "callback_data" in b && b.callback_data === `status:${order.id}:contacted`),
    "кнопка перевода в «на связи» присутствует",
  );

  assert(await repo.setOrderStatus(order.id, "contacted"), "статус меняется");
  assert((await repo.getOrderById(order.id))?.status === "contacted", "статус сохранён в БД");
  assert((await repo.listOrdersByStatus("new")).length === 0, "после смены статуса заявка уходит из new");
  assert(await repo.setOrderStatus(order.id, "done"), "статус done выставляется");
  const counts = await repo.countsForBot();
  assert(counts.revenueDone === product.price, "выручка считается по выполненным заявкам");
  assert(!(await repo.setOrderStatus("нет-такой", "done")), "несуществующая заявка не меняется молча");

  // ── Статусы доставки и трек-номер (меняет владелец в боте) ────────────────
  const shop = await import("../src/lib/shop");
  const cardBefore = screens.orderCardScreen((await repo.getOrderById(order.id))!);
  const deliveryButtons = cardBefore.keyboard!.inline_keyboard.flat();
  assert(
    deliveryButtons.some((b) => "callback_data" in b && b.callback_data === `delivery:${order.id}:packing`),
    "в карточке заявки есть кнопка статуса доставки",
  );
  assert(
    deliveryButtons.some((b) => "callback_data" in b && b.callback_data === `track:${order.id}`),
    "в карточке заявки есть кнопка трек-номера",
  );
  assert(screens.nextDeliveryStep("packing") === "shipped", "следующий шаг доставки: передан в доставку");
  assert(screens.nextDeliveryStep("done") === null, "после получения шагов больше нет");

  assert(await shop.setDeliveryStatus(order.id, "shipped"), "статус доставки меняется");
  const shipped = (await repo.getOrderById(order.id))!;
  assert(shipped.deliveryStatus === "shipped", "статус доставки сохранён в заявке");

  assert(screens.normalizeTrack("ru 123-456 789") === "RU123-456789", "трек-номер приводится к одному виду");
  assert(screens.normalizeTrack("   ") === null, "пустой трек не принимается");
  assert(screens.normalizeTrack("<b>x</b>") === null, "разметка в треке не принимается");

  assert(await shop.setDeliveryStatus(order.id, "pickup", "RU123-456789"), "трек-номер записывается вместе со статусом");
  const withTrack = (await repo.getOrderById(order.id))!;
  assert(withTrack.trackNumber === "RU123-456789", "трек-номер сохранён");
  const cardWithTrack = screens.orderCardScreen(withTrack);
  assert(cardWithTrack.text.includes("RU123-456789"), "карточка показывает трек-номер клиенту-админу");
  assert(cardWithTrack.text.includes("Ждёт в ПВЗ"), "карточка показывает человеческий статус доставки");

  const prompt = screens.trackPromptScreen(withTrack);
  assert(prompt.text.includes(order.id), "подсказка трека называет заявку");
  assert(!(await shop.setDeliveryStatus("нет-такой", "done")), "несуществующая заявка не получает статус доставки");

  // ── Правка товара ─────────────────────────────────────────────────────────
  const updated = await repo.updateProduct(product.id, { priceKopecks: 1234500 });
  assert(updated?.price === 1234500, "цена товара обновляется");
  const hidden = await repo.updateProduct(product.id, { isActive: false });
  assert(hidden?.isActive === false, "товар скрывается с витрины");
  const visible = (await repo.listCatalog()).flatMap((c) => c.products).find((p) => p.id === product.id);
  assert(visible === undefined, "скрытый товар исчезает из витрины");

  // ── Состояние диалога ─────────────────────────────────────────────────────
  await repo.setBotSession({ chatId: "1", kind: "edit", payload: `${product.id}:price` });
  const taken = await repo.takeBotSession("1");
  assert(taken?.payload === `${product.id}:price`, "состояние диалога читается");
  assert((await repo.takeBotSession("1")) === null, "состояние одноразовое — повторно не срабатывает");

  await repo.setBotSession({ chatId: "2", kind: "edit", payload: "x" });
  await repo.clearBotSession("2");
  assert((await repo.takeBotSession("2")) === null, "состояние сбрасывается по команде");

  rmSync(dir, { recursive: true, force: true });
  console.log("[check:bot] PASS — доступ, экраны, статусы и состояние диалога работают");
}

main().catch((err) => {
  console.error("[check:bot] ошибка:", err);
  process.exit(1);
});
