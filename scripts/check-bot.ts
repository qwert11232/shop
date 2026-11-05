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

async function dbAllFlow(orderId: string): Promise<{ status: string }[]> {
  const { getDb } = await import("../src/lib/db");
  const db = await getDb();
  return db.all<{ status: string }>("SELECT status FROM order_events WHERE order_id = ? ORDER BY created_at", [orderId]);
}

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
  const admin = await import("../src/lib/bot-screens-admin");
  const adminScreensEarly = admin;
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
  const menu = screens.menuScreen({
    newOrders: 3,
    awaitingPayment: 2,
    awaitingShipment: 1,
    activeProducts: 17,
    revenueDone: 17998000,
    paymentConfigured: false,
  });
  assert(menu.text.includes("Подтвердить: <b>3</b>"), "меню показывает очередь на подтверждение");
  assert(menu.text.includes("Ждут оплаты: <b>2</b>"), "меню показывает очередь ожидания оплаты");
  assert(menu.text.includes("Отправить: <b>1</b>"), "меню показывает очередь отправки");
  assert(menu.text.includes("Оплата не настроена"), "без реквизитов меню предупреждает владельца");
  // toLocaleString вставляет NBSP (U+00A0) — сравниваем, не завися от вида пробела.
  const flat = (value: string) => value.replace(/\u00a0|\u202f/g, " ");
  assert(flat(menu.text).includes("179 980 ₽"), "меню показывает выручку в рублях");
  const flatButtons = menu.keyboard!.inline_keyboard.flat();
  assert(flatButtons.some((b) => "callback_data" in b && b.callback_data === "orders:new"), "в меню есть кнопка заявок");
  assert(flatButtons.some((b) => "url" in b && b.url.startsWith("http")), "в меню есть кнопка витрины");
  assert(
    flatButtons.some((b) => "callback_data" in b && b.callback_data === "queue:confirmed"),
    "в меню есть переход к очереди оплаты",
  );
  assert(
    flatButtons.some((b) => "callback_data" in b && b.callback_data === "pay"),
    "в меню есть настройка оплаты",
  );

  // Без срочных дел меню не пугает цифрами нулей.
  const calmMenu = screens.menuScreen({
    newOrders: 0,
    awaitingPayment: 0,
    awaitingShipment: 0,
    activeProducts: 17,
    revenueDone: 0,
    paymentConfigured: true,
  });
  assert(calmMenu.text.includes("Срочных дел нет"), "пустые очереди дают спокойный текст");
  assert(!calmMenu.text.includes("Оплата не настроена"), "настроенная оплата не даёт предупреждения");

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
  // Полная карточка заказа живёт в панельном модуле: доставка, трек, позиции.
  const cardBefore = adminScreensEarly.orderAdminScreen((await repo.getOrderById(order.id))!, []);
  const deliveryButtons = cardBefore.keyboard.inline_keyboard.flat();
  assert(
    deliveryButtons.some((b) => "callback_data" in b && b.callback_data === `delivery:${order.id}:confirmed`),
    "в карточке заявки есть кнопка «Подтвердить заказ»",
  );
  const trackButton = deliveryButtons.find((b) => "callback_data" in b && b.callback_data === `track:${order.id}`);
  assert(
    trackButton && "text" in trackButton && trackButton.text.includes("после отправки"),
    "до отправки кнопка трека честно говорит, что трек ставится после отправки",
  );
  assert(
    cardBefore.text.includes("Ожидает подтверждения"),
    "в карточке виден статус клиента: ожидает подтверждения",
  );
  assert(
    deliveryButtons.some((b) => "callback_data" in b && b.callback_data === `ocomment:${order.id}`),
    "в карточке заявки есть кнопка комментария клиенту",
  );
  // Путь заказа: ожидает → подтверждён → оплачен → отправлен → получен.
  const status = await import("../src/lib/order-status");
  assert(status.nextDeliveryStep("new") === "confirmed", "после заявки шаг «подтвердить заказ»");
  assert(status.nextDeliveryStep("confirmed") === "paid", "после подтверждения шаг «оплата получена»");
  assert(status.nextDeliveryStep("paid") === "shipped", "после оплаты шаг «отправлено»");
  assert(status.nextDeliveryStep("packing") === "shipped", "исторический packing ведёт к отправке");
  assert(status.nextDeliveryStep("shipped") === "done", "после отправки шаг «получено»");
  assert(status.nextDeliveryStep("done") === null, "после получения шагов больше нет");
  assert(status.deliveryLabel("new") === "Ожидает подтверждения", "клиент видит «ожидает подтверждения»");
  assert(status.deliveryLabel("paid") === "Ожидает отправки", "после оплаты — «ожидает отправки»");
  assert(status.deliveryLabel("shipped") === "Отправлено", "оправленный заказ — «отправлено»");
  assert(!status.trackAllowed("confirmed"), "трек нельзя ставить до отправки");
  assert(status.trackAllowed("shipped"), "трек доступен после отправки");
  assert(admin.nextActionLabel("confirmed", "paid") === "Оплата получена", "кнопка называется действием, а не статусом");

  assert(await shop.setDeliveryStatus(order.id, "shipped"), "статус доставки меняется");
  const shipped = (await repo.getOrderById(order.id))!;
  assert(shipped.deliveryStatus === "shipped", "статус доставки сохранён в заявке");

  assert(screens.normalizeTrack("ru 123-456 789") === "RU123-456789", "трек-номер приводится к одному виду");
  assert(screens.normalizeTrack("   ") === null, "пустой трек не принимается");
  assert(screens.normalizeTrack("<b>x</b>") === null, "разметка в треке не принимается");

  assert(await shop.setDeliveryStatus(order.id, "pickup", "RU123-456789"), "трек-номер записывается вместе со статусом");
  const withTrack = (await repo.getOrderById(order.id))!;
  assert(withTrack.trackNumber === "RU123-456789", "трек-номер сохранён");
  const cardWithTrack = adminScreensEarly.orderAdminScreen(withTrack, []);
  assert(cardWithTrack.text.includes("RU123-456789"), "карточка показывает трек-номер клиенту-админу");
  assert(cardWithTrack.text.includes("Готов к выдаче"), "карточка показывает человеческий статус доставки («Готов к выдаче»)");

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

  // ── Панель: новый товар, варианты, характеристики, фото, бонусы ───────────
  const flow = await import("../src/lib/bot-admin-flow");
  const input = await import("../src/lib/bot-input");
  const adminScreens = await import("../src/lib/bot-screens-admin");

  // Разбор ввода: мусор не должен попадать в базу.
  assert(input.parsePriceRub("89 990") === 8999000, "цена с пробелами разбирается");
  assert(input.parsePriceRub("89.990") === 8999000, "точка как разделитель тысяч");
  assert(input.parsePriceRub("0") === null, "нулевая цена отклоняется");
  assert(input.parsePriceRub("12a") === null, "буквы в цене отклоняются");
  assert(input.parsePriceRub("999000000") === null, "цена выше 100 млн отклоняется");
  assert(input.parsePriceRub("12.5") === null, "дробная цена не принимается молча как 12");
  assert(input.parsePriceRub("89 990 ₽") === 8999000, "знак рубля не мешает разбору");

  const parsedVariant = input.parseVariantLine("512 ГБ +15000");
  assert(parsedVariant?.label === "512 ГБ" && parsedVariant.extraRub === 15000, "вариант с надбавкой разбирается");
  assert(input.parseVariantLine("128 ГБ -8000")?.extraRub === -8000, "отрицательная надбавка разрешена");
  assert(input.parseVariantLine("   ") === null, "пустой вариант отклоняется");
  assert(input.guessVariantKind("Чёрный титан") === "color", "цвет определяется по названию");
  assert(input.guessVariantKind("256 ГБ") === "storage", "память определяется по названию");

  const specText = "Встроенная память: 256 ГБ\nДиагональ: 6,3″\nМатериал: титан\nмусор без двоеточия";
  const parsedSpecs = input.parseSpecLines(specText);
  assert(parsedSpecs.specs.length === 3, "три характеристики разобраны, мусорная строка отброшена");
  assert(parsedSpecs.skipped.length === 1, "неразобранная строка возвращается владельцу");
  const memory = parsedSpecs.specs.find((s) => s.name === "Встроенная память");
  assert(memory?.value === "256" && memory.unit === "ГБ" && memory.numeric === 256, "значение и единица разделены");
  assert(memory?.group === "Производительность", "характеристика попадает в смысловую группу");

  assert(input.parsePhone("8 900 123-45-67") === "+79001234567", "телефон приводится к +7");
  assert(input.parsePhone("123") === null, "короткий телефон отклоняется");
  assert(input.parseId("ab") === null, "слишком короткий id отклоняется");

  // Пошаговый черновик: шаги заполняются, пока не хватает обязательных полей.
  const draftAfter = await flow.applyDraftField({}, "title", "Тестовый товар из бота");
  assert(draftAfter.draft.title === "Тестовый товар из бота", "название попадает в черновик");
  assert(Boolean((await flow.applyDraftField({}, "price", "abc")).error), "неверная цена возвращает ошибку");
  const withPrice = await flow.applyDraftField(draftAfter.draft, "price", "12 990");
  assert(withPrice.draft.price === 1299000, "цена попадает в черновик в копейках");

  const draftScreenMissing = adminScreens.draftScreen(withPrice.draft);
  assert(
    !draftScreenMissing.keyboard.inline_keyboard.flat().some((b) => "callback_data" in b && b.callback_data === "add:create"),
    "пока нет категории, кнопки «Создать» нет",
  );

  const category = await flow.ensureCategory("Тестовая категория");
  assert(category?.created === true, "новая категория создаётся из бота");
  assert((await flow.ensureCategory("Тестовая категория"))?.created === false, "повторно категория не дублируется");

  const withCategory = await flow.setDraftCategory(withPrice.draft, category!.id);
  assert(withCategory.draft.categoryId === category!.id, "категория подставляется в черновик");
  const draftReady = adminScreens.draftScreen(withCategory.draft);
  assert(
    draftReady.keyboard.inline_keyboard.flat().some((b) => "callback_data" in b && b.callback_data === "add:create"),
    "когда всё заполнено, кнопка «Создать» появляется",
  );

  const created = await flow.createFromDraft(withCategory.draft);
  assert(created.ok && Boolean(created.product), "товар создаётся из черновика");
  const createdProduct = created.product!;
  assert(createdProduct.title === "Тестовый товар из бота" && createdProduct.price === 1299000, "поля товара сохранены");
  const adminCard = adminScreens.productAdminScreen({
    ...createdProduct,
    brand: "Тест",
    categoryName: "Тестовая категория",
  });
  assert(adminCard.text.includes("Тестовый товар из бота"), "карточка товара показывает название");
  const cardButtons = adminCard.keyboard.inline_keyboard.flat();
  for (const action of ["variants", "specs", "cat", "del", "toggle", "gallery"]) {
    assert(
      cardButtons.some((b) => "callback_data" in b && b.callback_data.startsWith(`${action}:`)),
      `в карточке есть раздел «${action}»`,
    );
  }

  // Варианты: добавляются пачкой, мусор не теряется молча.
  const variantsAdded = await flow.addVariants(createdProduct.id, "128 ГБ -8000\n256 ГБ\nЧёрный титан\n??");
  assert(variantsAdded.added === 3, "три варианта добавлены");
  assert(variantsAdded.skipped.length === 1, "неразобранная строка возвращается");
  const variants = await flow.variantsOf(createdProduct.id);
  assert(variants.length === 3, "варианты читаются из базы");
  const storage = variants.find((v) => v.label === "256 ГБ");
  assert(storage?.kind === "storage", "вид варианта определён автоматически");
  assert(await flow.removeVariant(createdProduct.id, variants[0].id), "вариант удаляется");
  assert((await flow.variantsOf(createdProduct.id)).length === 2, "после удаления остаётся два");

  // Характеристики: одинаковое имя обновляется, новое добавляется.
  await flow.addSpecs(createdProduct.id, "Память: 256 ГБ");
  await flow.addSpecs(createdProduct.id, "Память: 512 ГБ");
  const specs = await flow.specsOf(createdProduct.id);
  const specsNamed = specs.filter((s) => s.name === "Память");
  assert(specsNamed.length === 1, "повторная характеристика обновляет, а не дублирует");
  assert(specsNamed[0].value === "512", "значение характеристики обновлено");
  assert(await flow.removeSpec(createdProduct.id, "Память"), "характеристика удаляется");
  assert((await flow.specsOf(createdProduct.id)).length === 0, "список характеристик пуст");

  // Галерея: видео только ссылкой на файл.
  assert((await flow.addGalleryVideo(createdProduct.id, "https://cdn.example.com/a.mp4")).ok, "видео по ссылке принимается");
  assert(!(await flow.addGalleryVideo(createdProduct.id, "https://example.com/page")).ok, "обычная ссылка не считается видео");
  assert(!(await flow.addGalleryVideo(createdProduct.id, "javascript:alert(1)")).ok, "опасная схема отклоняется");

  // Обложка: ссылка на файл встаёт и в товар, и первым кадром галереи.
  await flow.setCover(createdProduct.id, "https://cdn.example.com/cover.jpg");
  const covered = await repo.getProductById(createdProduct.id);
  assert(covered?.photoUrl === "https://cdn.example.com/cover.jpg", "обложка товара обновлена");

  // Правка полей и удаление.
  const priceEdit = await flow.applyProductField(createdProduct.id, "price", "15 000");
  assert(priceEdit.product?.price === 1500000, "цена меняется из бота");
  const brandEdit = await flow.applyProductField(createdProduct.id, "brand", "Тестбренд");
  assert(brandEdit.product?.brand === "Тестбренд", "бренд сохраняется");
  const descEdit = await flow.applyProductField(createdProduct.id, "desc", "Подробное описание товара из бота");
  assert(descEdit.ok, "описание сохраняется");
  assert(!(await flow.applyProductField(createdProduct.id, "desc", "мало")).ok, "слишком короткое описание отклоняется");
  assert(!(await flow.applyProductField(createdProduct.id, "price", "десять")).ok, "текст вместо цены отклоняется");
  assert(await flow.removeProduct(createdProduct.id), "товар удаляется");
  assert((await repo.getProductById(createdProduct.id)) === null, "удалённого товара больше нет");

  // Покупатели и бонусы. Профиль «555» уже получал кешбэк за заказ выше,
  // поэтому ждём прибавку, а не абсолютный баланс.
  const beforeGift = (await shop.getCustomer("555"))?.bonusBalance ?? 0;
  await shop.grantBonus({ tgUserId: "555", amount: 10000, reason: "Подарок" });
  const customerWithBonus = await shop.getCustomer("555");
  assert(
    (customerWithBonus?.bonusBalance ?? 0) === beforeGift + 10000,
    "бонусы начисляются владельцем",
  );
  const balanceAfterGift = (await shop.getCustomer("555"))?.bonusBalance ?? 0;
  const bonusOk = await flow.applyBonus("555", "-50");
  assert(bonusOk.ok && bonusOk.balance === balanceAfterGift - 5000, "списание бонусов владельцем");
  assert(!(await flow.applyBonus("555", "-9999")).ok, "списать больше баланса нельзя");
  assert(!(await flow.applyBonus("нет-такого", "-100")).ok, "списание незнакомому ID отклоняется (опечатка видна)");
  assert((await flow.applyBonus("444", "300")).ok, "начисление создаёт профиль, если заказа ещё не было");
  const customers = await shop.listCustomers();
  assert(customers.length > 0, "покупатели читаются для панели");
  const customerCard = adminScreens.customerScreen(customers[0], customers[0].ordersCount);
  assert(customerCard.text.includes("Telegram ID"), "карточка покупателя показывает ID для связи");

  // Комментарий к заказу виден клиенту (причина отмены).
  assert((await flow.applyOrderComment(order.id, "Позвоним завтра утром")).ok, "комментарий к заказу сохраняется");
  assert((await repo.getOrderById(order.id))?.comment === "Позвоним завтра утром", "комментарий попал в заказ");

  // Отмена заказа возвращает бонусы и снимает кешбэк.
  const bonusForCancel = await shop.getCustomer("555");
  const balanceBeforeCancel = bonusForCancel?.bonusBalance ?? 0;
  await shop.setDeliveryStatus(order.id, "cancelled");
  const afterCancel = await shop.getCustomer("555");
  assert(
    (afterCancel?.bonusBalance ?? 0) <= balanceBeforeCancel,
    "отмена снимает начисленный кешбэк, но не уводит баланс в минус",
  );
  assert((await repo.getOrderById(order.id))?.status === "cancelled", "отменённый заказ помечен в CRM-статусе");

  // Экраны панели на реальных данных.
  const listScreen = adminScreens.productsListScreen(await repo.listProductsAdmin(), 0);
  assert(listScreen.text.includes("Товары"), "список товаров собирается");
  const stats = adminScreens.statsScreen({
    orders: 3,
    revenue: 300000,
    newOrders: 1,
    products: 5,
    activeProducts: 4,
    customers: 2,
    bonusIssued: 1000,
  });
  assert(stats.text.includes("Средний чек"), "сводка считает средний чек");

  // ── Получатель заказов: группа или личка админов ──────────────────────────
  const tg = await import("../src/lib/telegram");
  delete process.env.BOT_TOKEN;
  delete process.env.GROUP_CHAT_ID;
  delete process.env.ADMIN_TELEGRAM_IDS;
  delete process.env.OWNER_TELEGRAM_ID;
  assert(!tg.ordersReceiverConfigured(), "без токена заказам некуда идти — это видно в /api/health");
  process.env.BOT_TOKEN = "test-token";
  assert(!tg.ordersReceiverConfigured(), "с токеном, но без получателя — тоже некуда");
  process.env.ADMIN_TELEGRAM_IDS = "111, 222";
  assert(tg.ordersReceiverConfigured(), "без группы заказ уходит админам в личку");
  process.env.GROUP_CHAT_ID = "me";
  assert(tg.ordersReceiverConfigured(), "значение me означает «в личку админам»");
  process.env.GROUP_CHAT_ID = "-100123456";
  assert(tg.ordersReceiverConfigured(), "с группой заказ уходит в группу");
  delete process.env.GROUP_CHAT_ID;
  delete process.env.BOT_TOKEN;

  // ── Путь заказа: уведомление → подтверждение → оплата → отправка → трек ────
  // Сценарий клиента: заказ создан, админ ведёт его по шагам, клиенту на каждый
  // шаг приходит текст, а трек нельзя поставить раньше отправки.
  assert(status.customerStatusNotice({ id: "o", total: 100, deliveryStatus: "new" }) === null,
    "на новую заявку клиенту не шлём — это ответ на его же действие");
  const noticeConfirmed = status.customerStatusNotice({ id: "o1", total: 8999000, deliveryStatus: "confirmed" });
  assert(noticeConfirmed?.includes("подтверждён") && noticeConfirmed.includes("89 990"), "клиент узнаёт о подтверждении и сумме");
  const noticePaid = status.customerStatusNotice({ id: "o1", total: 8999000, deliveryStatus: "paid" });
  assert(noticePaid?.includes("ожидает отправки"), "после оплаты клиент видит «ожидает отправки»");
  const noticeShipped = status.customerStatusNotice({ id: "o1", total: 100, deliveryStatus: "shipped", trackNumber: "RU123" });
  assert(noticeShipped?.includes("отправлен") && noticeShipped.includes("RU123"), "об отправке приходит сообщение с треком");
  const noticeCancelled = status.customerStatusNotice({ id: "o1", total: 100, deliveryStatus: "cancelled", comment: "нет в наличии" });
  assert(noticeCancelled?.includes("отменён") && noticeCancelled.includes("нет в наличии"), "об отмене сообщаем с причиной");
  assert(noticeCancelled?.includes("бонусы"), "при отмене напоминаем про возврат бонусов");

  // Сквозной путь по базе: new → confirmed → paid → shipped → done + трек.
  const realProduct = await repo.listProductsAdmin();
  const flowItem = realProduct[0];
  const flowOrder = await shop.createPurchaseOrder({
    tgUserId: "888",
    contactName: "Путь",
    contactPhone: "+79990000000",
    comment: "",
    bonusToUse: 0,
    total: 100000,
    items: [{ productId: flowItem.id, quantity: 1 }],
  });
  assert(flowOrder.deliveryStatus === "new", "новый заказ начинается со статуса «ожидает подтверждения»");
  assert(status.deliveryLabel(flowOrder.deliveryStatus) === "Ожидает подтверждения", "клиент видит понятную подпись");
  assert(await shop.setDeliveryStatus(flowOrder.id, "confirmed"), "админ подтверждает заказ");
  assert(await shop.setDeliveryStatus(flowOrder.id, "paid"), "админ отмечает оплату");
  assert(await shop.setDeliveryStatus(flowOrder.id, "shipped", "RU999888777"), "админ отправляет заказ с треком");
  const shippedFlow = (await shop.listMyOrders("888")).find((o) => o.id === flowOrder.id)!;
  assert(shippedFlow.deliveryStatus === "shipped" && shippedFlow.trackNumber === "RU999888777",
    "клиент в кабинете видит статус «Отправлено» и трек-номер");
  assert(status.deliveryStepIndex("shipped") === 3, "на полосе прогресса отправка — четвёртый шаг");
  assert(status.deliveryStepIndex("cancelled") === -1, "у отменённого заказа прогресс не рисуется");
  const history = await dbAllFlow(flowOrder.id);
  // Оформление пишет событие `new` (клиент), дальнейшие шаги — по одному на действие.
  assert(history.length === 4, `каждый шаг пишется в историю заказа (${history.length} события)`);
  assert(["new", "confirmed", "paid", "shipped"].every((st) => history.some((h) => h.status === st)),
    "в истории есть оформление, подтверждение, оплата и отправка");

  // ── Оплата: настройки, ссылка, реквизиты в сообщении клиенту ─────────────
  const settings = await import("../src/lib/settings");
  const emptySettings = await settings.getSettings();
  assert(!settings.paymentConfigured(emptySettings), "по умолчанию оплата не настроена");
  await settings.setSetting("payment_details", "  СБП по номеру +7 900 111-22-33  ");
  // Ссылка нормализуется так же, как это делает панель при вводе.
  const normalized = settings.parsePaymentLink("pay.example.com/order");
  assert(normalized.ok, "ссылка на оплату разбирается");
  await settings.setSetting("payment_link", normalized.ok ? normalized.url : "");
  const saved = await settings.getSettings();
  assert(saved.payment_details === "СБП по номеру +7 900 111-22-33", "реквизиты сохранены без лишних пробелов");
  assert(settings.paymentConfigured(saved), "после реквизитов оплата считается настроенной");

  assert(!settings.parsePaymentLink("").ok, "пустая ссылка отклоняется");
  assert(!settings.parsePaymentLink("pay me now").ok, "ссылка с пробелом отклоняется");
  assert(!settings.parsePaymentLink("localhost").ok, "адрес без домена отклоняется");
  const parsedLink = settings.parsePaymentLink("pay.example.com/o/123");
  assert(parsedLink.ok && parsedLink.url === "https://pay.example.com/o/123", "ссылка дополняется https://");

  await settings.setSetting("payment_details", "");
  assert((await settings.getSettings()).payment_details === "", "пустое значение стирает настройку");
  await settings.setSetting("payment_details", "Карта 2200 0000 0000 0000");

  // Клиент получает реквизиты вместе с подтверждением и ссылку — если задана.
  const payInfo = {
    details: saved.payment_details,
    link: saved.payment_link,
    note: "Чек пришлём в чат",
    phone: "+7 900 111-22-33",
  };
  const confirmedNotice = status.customerStatusNotice(
    { id: "o-pay", total: 129900, deliveryStatus: "confirmed" },
    payInfo,
  );
  assert(confirmedNotice?.includes("СБП по номеру"), "в подтверждении есть реквизиты");
  assert(confirmedNotice?.includes("https://pay.example.com/order"), "в подтверждении есть ссылка на оплату");
  assert(confirmedNotice?.includes("Чек пришлём"), "приписка к оплате доходит до клиента");
  assert(confirmedNotice?.includes("+7 900 111-22-33"), "телефон магазина виден клиенту");
  const noPayNotice = status.customerStatusNotice({ id: "o-pay", total: 100, deliveryStatus: "confirmed" });
  assert(noPayNotice?.includes("пришлём реквизиты"), "без настроек клиент не остаётся без инструкции");

  const payScreen = adminScreens.paymentScreen(saved);
  assert(payScreen.text.includes("СБП по номеру"), "экран оплаты показывает сохранённые реквизиты");
  const payButtons = payScreen.keyboard.inline_keyboard.flat();
  assert(
    payButtons.some((b) => "callback_data" in b && b.callback_data === "payset:payment_link"),
    "в экране оплаты можно изменить ссылку",
  );

  // ── Массовые действия ────────────────────────────────────────────────────
  const bulkCategories = await repo.listCategoriesAdmin();
  const bulkTarget = bulkCategories.find((c) => c.productCount >= 2)!;
  assert(Boolean(bulkTarget), "для массовых действий есть категория с товарами");
  // Кнопка «Массовые действия» без категории должна показывать выбор категории,
  // а не «Категория не найдена» (регрессия после удаления дубликата case "bulk").
  const bulkHub = adminScreens.bulkScreen(bulkCategories);
  assert(bulkHub.text.includes("Массовые действия"), "голый callback bulk открывает выбор категории");
  assert(
    bulkHub.keyboard.inline_keyboard.flat().some((b) => "callback_data" in b && b.callback_data === `bulkcat:${bulkTarget.id}`),
    "в списке массовых действий есть кнопка категории",
  );
  const beforeBulk = await flow.categoryVisibility(bulkTarget.id);
  assert(beforeBulk.active === beforeBulk.total, "в тестовой категории все товары видны");

  const hiddenBulk = await flow.bulkSetActive(bulkTarget.id, false);
  assert(hiddenBulk.affected === beforeBulk.total, `скрыты все товары категории (${hiddenBulk.affected})`);
  const hiddenCounts = await flow.categoryVisibility(bulkTarget.id);
  assert(hiddenCounts.active === 0 && hiddenCounts.hidden === beforeBulk.total, "после скрытия витрина пуста");
  const visibleAfterHide = await repo.listCatalog();
  const stillThere = visibleAfterHide.some((c) => c.id === bulkTarget.id && c.products.length > 0);
  assert(!stillThere, "скрытые товары не показываются на витрине");
  const againHide = await flow.bulkSetActive(bulkTarget.id, false);
  assert(againHide.affected === 0, "повторное скрытие честно сообщает «0 изменений»");

  await flow.bulkSetActive(bulkTarget.id, true);
  assert((await flow.categoryVisibility(bulkTarget.id)).active === beforeBulk.total, "товары возвращаются на витрину");

  const beforePrices = (await repo.listProductsAdmin()).filter((p) => p.categoryName === bulkTarget.name);
  const priceBefore = beforePrices[0].price;
  const repriced = await flow.bulkReprice(bulkTarget.id, 10);
  assert(repriced.affected === repriced.total, "цены изменились у всех товаров категории");
  const afterPrices = (await repo.listProductsAdmin()).filter((p) => p.categoryName === bulkTarget.name);
  assert(
    afterPrices[0].price === Math.round((priceBefore * 110) / 100 / 100) * 100,
    "цена выросла на 10% и округлена до рубля",
  );
  assert(afterPrices.every((p) => p.price % 100 === 0), "после массового изменения нет цен с копейками");
  await flow.bulkReprice(bulkTarget.id, -10);
  const restoredPrices = (await repo.listProductsAdmin()).filter((p) => p.categoryName === bulkTarget.name);
  // Возврат на -10% не равен исходной цене: проценты считаются от округлённой
  // цены, поэтому расхождение до 1% — математика, а не баг. Проверяем порядок
  // величины, а не точное совпадение.
  const drift = Math.abs(restoredPrices[0].price - priceBefore) / priceBefore;
  assert(drift < 0.015, `обратный процент возвращает цену с расхождением до 1,5% (${(drift * 100).toFixed(2)}%)`);
  assert(restoredPrices.every((p) => p.price % 100 === 0), "после снижения цены тоже целые рубли");

  // Проценты: мусор не принимается, диапазон ограничен.
  assert(adminScreens.parsePricePercent("+5") === 5, "процент с плюсом разбирается");
  assert(adminScreens.parsePricePercent("-10%") === -10, "процент с минусом и знаком % разбирается");
  assert(adminScreens.parsePricePercent("5,5") === 5.5, "дробный процент разбирается");
  assert(adminScreens.parsePricePercent("0") === null, "ноль не меняет ничего — отклоняется");
  assert(adminScreens.parsePricePercent("+80") === null, "слишком большой процент отклоняется");
  assert(adminScreens.parsePricePercent("дороже") === null, "слова вместо процента отклоняются");

  // Цена не может упасть до нуля даже при максимальной скидке.
  const cheap = await repo.listProductsAdmin();
  const cheapTarget = cheap.reduce((min, p) => (p.price < min.price ? p : min), cheap[0]);
  await flow.bulkReprice(bulkTarget.id, -50);
  const flooredPrices = await repo.listProductsAdmin();
  assert(flooredPrices.every((p) => p.price >= 100), "минимальная цена — 1 ₽, бесплатных товаров нет");
  void cheapTarget;

  // ── Поиск заказа и очереди ───────────────────────────────────────────────
  const searchOrder = (await repo.getOrderById(flowOrder.id))!;
  const byTail = await repo.searchOrders(searchOrder.id.slice(-5));
  assert(byTail.some((o) => o.id === searchOrder.id), "заказ находится по хвосту номера");
  const byPhone = await repo.searchOrders("9990000000");
  assert(Array.isArray(byPhone), "поиск по телефону не падает");
  // Поиск идёт и по имени клиента, поэтому «абвгд» может найтись, если так
  // назвали заказ в этом прогоне. Проверяем не пустоту, а отсутствие ложных
  // совпадений: запрос, которого точно нет, ничего не возвращает.
  assert((await repo.searchOrders("zzzzzz")).length === 0, "несуществующий запрос даёт пустой список");
  assert((await repo.searchOrders("100%")).length === 0, "процент в запросе не работает как шаблон LIKE");
  assert((await repo.searchOrders("_")).length === 0, "подчёркивание не совпадает с любым символом");
  assert((await repo.searchOrders("я")).length === 0, "одна буква не запускает поиск по всей базе");

  const emptySearch = adminScreens.orderSearchResultScreen("zzz", []);
  assert(emptySearch.text.includes("Ничего не нашлось"), "пустой поиск объясняет результат");
  const foundScreen = adminScreens.orderSearchResultScreen("ord-1", [searchOrder]);
  assert(foundScreen.text.includes(searchOrder.id), "результат поиска показывает номер заказа");

  const queues = await repo.orderQueueCounts();
  assert(typeof queues.awaitingPayment === "number", "очередь оплаты считается");
  await shop.setDeliveryStatus(searchOrder.id, "confirmed");
  const paidQueue = await repo.listOrdersByDelivery("confirmed");
  assert(paidQueue.some((o) => o.id === searchOrder.id), "подтверждённый заказ попадает в очередь оплаты");
  await shop.setDeliveryStatus(searchOrder.id, "paid");
  const shipQueue = await repo.listOrdersByDelivery("paid");
  assert(shipQueue.some((o) => o.id === searchOrder.id), "оплаченный заказ попадает в очередь отправки");
  const queueView = adminScreens.queueScreen(shipQueue, "paid");
  assert(queueView.text.includes("Ждут отправки"), "экран очереди называет себя по-человечески");
  const emptyQueue = adminScreens.queueScreen([], "confirmed");
  assert(emptyQueue.text.includes("Пусто"), "пустая очередь говорит, что всё разобрано");

  rmSync(dir, { recursive: true, force: true });
  console.log("[check:bot] PASS — доступ, экраны, товары, варианты, характеристики, бонусы и заказы работают");
}

main().catch((err) => {
  console.error("[check:bot] ошибка:", err);
  process.exit(1);
});
