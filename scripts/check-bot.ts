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
  // Полная карточка заказа живёт в панельном модуле: доставка, трек, позиции.
  const cardBefore = adminScreensEarly.orderAdminScreen((await repo.getOrderById(order.id))!, []);
  const deliveryButtons = cardBefore.keyboard.inline_keyboard.flat();
  assert(
    deliveryButtons.some((b) => "callback_data" in b && b.callback_data === `delivery:${order.id}:packing`),
    "в карточке заявки есть кнопка статуса доставки",
  );
  assert(
    deliveryButtons.some((b) => "callback_data" in b && b.callback_data === `track:${order.id}`),
    "в карточке заявки есть кнопка трек-номера",
  );
  assert(
    deliveryButtons.some((b) => "callback_data" in b && b.callback_data === `ocomment:${order.id}`),
    "в карточке заявки есть кнопка комментария клиенту",
  );
  assert(admin.nextDeliveryStep("packing") === "shipped", "следующий шаг доставки: передан в доставку");
  assert(admin.nextDeliveryStep("done") === null, "после получения шагов больше нет");

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

  rmSync(dir, { recursive: true, force: true });
  console.log("[check:bot] PASS — доступ, экраны, товары, варианты, характеристики, бонусы и заказы работают");
}

main().catch((err) => {
  console.error("[check:bot] ошибка:", err);
  process.exit(1);
});
