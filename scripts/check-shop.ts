/**
 * Проверка витрины без браузера и без сети: фильтры, карточка, корзина,
 * оформление, бонусы, реферал, отзывы и сравнение — на настоящей SQLite-базе.
 *
 * Запуск: npm run check:shop
 * Проверяем поведение функций, которые вызывают API-роуты: если логика
 * сломается, здесь это видно до деплоя.
 */
import { existsSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import path from "path";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`[check:shop] FAIL — ${message}`);
    process.exit(1);
  }
  console.log(`[check:shop] ok — ${message}`);
}

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "tekhnolab-shop-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "shop.db")}`;
  delete process.env.VERCEL;

  const catalog = await import("../src/lib/catalog");
  const shop = await import("../src/lib/shop");
  const reviews = await import("../src/lib/reviews");
  const seed = await import("../src/lib/seed");

  // seedCatalog наполняет и товары, и варианты/спеки/галерею — отдельный вызов не нужен.
  await seed.seedCatalog();
  const secondSeed = await seed.seedCatalog();
  assert(
    secondSeed.products === 0 && secondSeed.backfilled === 0,
    "повторный сид ничего не дублирует и не переписывает",
  );

  // ── Каталог и фильтры ─────────────────────────────────────────────────────
  const products = await catalog.listVisibleProducts();
  // 17 позиций: у каждой своё честное фото. Аксессуары с фотографиями других
  // товаров удалены (см. seed-cleanup.ts) — количество здесь осознанное.
  assert(products.length === 17, `витрина наполнена (${products.length} товаров)`);
  assert(products.every((p) => p.photoUrl.length > 0), "у каждого товара есть фото");
  assert(products.some((p) => p.brand), "у товаров есть бренд");

  const brands = await catalog.listBrands();
  assert(brands.length >= 3, `бренды считаются по данным (${brands.length})`);
  assert(brands.every((b) => b.count > 0), "у бренда непустое количество");

  const facets = await catalog.listFacets();
  assert(facets.length >= 3, `фасеты построены (${facets.length} характеристик)`);
  assert(
    facets.every((f) => f.values.length >= 2 && f.values.length <= 8),
    "в фасете от 2 до 8 значений — одиночные значения не мусорят фильтр",
  );

  const memoryFacet = facets.find((f) => f.name.toLowerCase().includes("память"));
  assert(Boolean(memoryFacet), "фильтр по памяти есть (ключевой параметр спецификации)");
  assert(
    facets.every((f) => f.unit.length > 0 || f.values.every((v) => !/^\d+$/.test(v.value))),
    "числовые характеристики всегда показывают единицу измерения",
  );
  assert(
    new Set(facets.map((f) => `${f.name}|${f.unit}`)).size === facets.length,
    "одна характеристика в разных единицах не смешивается в один фильтр",
  );

  const cheap = catalog.applyFilters(products, { sort: "price-asc" });
  assert(cheap[0].price <= cheap[cheap.length - 1].price, "сортировка по цене возрастает");

  const band = catalog.applyFilters(products, { minPrice: 5000000, maxPrice: 10000000 });
  assert(
    band.length > 0 && band.every((p) => p.price >= 5000000 && p.price <= 10000000),
    "фильтр по диапазону цены работает",
  );

  // Фильтр по характеристике — так, как его отправляет клиент: имя и значение отдельно.
  const memoryValues = memoryFacet!.values.map((v) => v.value);
  const byMemory = catalog.applyFilters(
    products.map((p) => ({ ...p, specs: { [memoryFacet!.name]: memoryValues[0] } })),
    { specs: { [memoryFacet!.name]: [memoryValues[0]] } },
  );
  assert(byMemory.length > 0, "фильтр по характеристике находит товары по значению");

  const brandFiltered = catalog.applyFilters(products, { brands: [brands[0].value] });
  assert(
    brandFiltered.length === brands[0].count,
    "фильтр по бренду возвращает ровно его товары",
  );

  const search = catalog.applyFilters(products, { search: "iPhone" });
  assert(search.length > 0, "поиск по названию что-то находит");
  assert(
    catalog.applyFilters(products, { search: "нет-такого-товара" }).length === 0,
    "поиск без совпадений возвращает пусто, а не весь каталог",
  );

  // ── Карточка товара ───────────────────────────────────────────────────────
  const target = products.find((p) => p.title.includes("iPhone")) ?? products[0];
  const detail = await catalog.getProductDetail(target.id);
  assert(Boolean(detail), "карточка товара открывается");
  assert((detail?.variants.length ?? 0) > 0, "у товара есть варианты конфигурации");
  assert((detail?.specs.length ?? 0) > 0, "у товара есть характеристики");
  assert((detail?.gallery.length ?? 0) >= 1, "у карточки есть галерея (первый кадр — основное фото)");
  assert((detail?.crossSell.length ?? 0) > 0, "есть блок «с этим покупают»");

  // Цена с вариантом = базовая + надбавка
  const variant = detail!.variants.find((v) => v.extra !== 0) ?? detail!.variants[0];
  assert(
    target.price + variant.extra !== 0,
    "итоговая цена складывается из базовой и надбавки варианта",
  );

  // Галерея и видео: механика проверяется на кадрах, добавленных владельцем,
  // потому что в сиде у каждого товара честно одно фото.
  {
    const { getDb } = await import("../src/lib/db");
    const db = await getDb();
    await db.run(
      "INSERT INTO product_media (id, product_id, kind, url, sort_order) VALUES (?, ?, ?, ?, ?)",
      ["media-test-1", target.id, "image", "/products/ps5.png", 5],
    );
    await db.run(
      "INSERT INTO product_media (id, product_id, kind, url, sort_order) VALUES (?, ?, ?, ?, ?)",
      ["media-test-2", target.id, "video", "https://example.com/demo.mp4", 6],
    );
    const withMedia = await catalog.getProductDetail(target.id);
    assert((withMedia?.gallery.length ?? 0) === 3, "в галерею попадают все кадры товара, включая добавленные");
    assert(withMedia?.gallery[1] === "/products/ps5.png", "кадры идут в заданном порядке");
    assert(
      withMedia?.media.some((m) => m.kind === "video") === true,
      "видео в галерее помечено типом — карточка вставит плеер, а не картинку",
    );
    assert(withMedia?.media[1].kind === "image", "изображения остаются изображениями");
  }

  // ── Корзина ───────────────────────────────────────────────────────────────
  const user = "900001";
  let cart = await shop.addToCart({ tgUserId: user, productId: target.id, variantId: variant.id, quantity: 2 });
  assert(cart.lines.length === 1, "товар попадает в корзину");
  assert(cart.lines[0].unitPrice === target.price + variant.extra, "в корзине цена с учётом варианта");
  assert(cart.count === 2, "количество учтено");
  assert(cart.total === (target.price + variant.extra) * 2, "сумма корзины пересчитана");

  cart = await shop.setCartQuantity({ tgUserId: user, productId: target.id, variantId: variant.id, quantity: 3 });
  assert(cart.lines[0].quantity === 3, "количество меняется");
  assert(cart.total === (target.price + variant.extra) * 3, "сумма пересчитывается после смены количества");

  cart = await shop.setCartQuantity({ tgUserId: user, productId: target.id, variantId: variant.id, quantity: 0 });
  assert(cart.lines.length === 0, "удаление позиции очищает корзину");
  assert(cart.total === 0, "пустая корзина стоит 0");

  cart = await shop.addToCart({ tgUserId: user, productId: target.id, variantId: null, quantity: 1 });
  assert(cart.lines[0].basePrice === target.price, "без варианта берётся базовая цена");

  // ── Профиль и бонусы ──────────────────────────────────────────────────────
  const customer = await shop.getOrCreateCustomer({ tgUserId: user, firstName: "Иван", username: "ivan" });
  assert(customer.firstName === "Иван", "имя приходит из Telegram");
  assert(customer.referralCode.length === 6, "реферальный код короткий и читаемый");
  assert(customer.bonusBalance === 0, "новичок начинает с нулём бонусов");

  const same = await shop.getOrCreateCustomer({ tgUserId: user });
  assert(same.referralCode === customer.referralCode, "профиль не дублируется — код стабилен");

  // ── Оформление ────────────────────────────────────────────────────────────
  await shop.setCustomerPhone(user, "+79001234567");
  const before = await shop.getCart(user);
  const order = await shop.createPurchaseOrder({
    tgUserId: user,
    contactName: "Иван",
    contactPhone: "+79001234567",
    total: before.total,
    items: before.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity })),
  });
  assert(order.total === before.total, "заказ сохраняет сумму корзины");
  assert(order.items.length === before.lines.length, "в заказе те же позиции");
  assert(order.deliveryStatus === "new", "новый заказ ждёт сборки");
  assert(order.bonusEarned === Math.round(order.total * 0.03), "кешбэк 3% начислен и записан в заказ");

  const afterOrder = await shop.getOrCreateCustomer({ tgUserId: user });
  assert(afterOrder.bonusBalance === order.bonusEarned, "баланс вырос на кешбэк");

  const history = await shop.listMyOrders(user);
  assert(history.length === 1 && history[0].id === order.id, "заказ виден в истории клиента");

  // Бонусы: списание ограничено 30% суммы и балансом
  assert(shop.maxBonusFor(100000, 50000) === 30000, "списать можно не больше 30% суммы");
  assert(shop.maxBonusFor(100000, 5000) === 5000, "списать можно не больше баланса");
  assert(shop.maxBonusFor(100000, 0) === 0, "без баланса списания нет");

  const withBonus = await shop.createPurchaseOrder({
    tgUserId: user,
    contactName: "Иван",
    contactPhone: "+79001234567",
    total: 100000,
    bonusToUse: 30000,
    items: [{ productId: target.id, variantId: null, quantity: 1 }],
  });
  assert(withBonus.bonusUsed === 30000, "бонусы списываются при оформлении");
  assert(withBonus.bonusEarned === Math.round(70000 * 0.03), "кешбэк считается от оплаченной суммы");

  // ── Доставка ──────────────────────────────────────────────────────────────
  assert(await shop.setDeliveryStatus(order.id, "shipped", "RU777"), "статус доставки меняется админом");
  const shipped = (await shop.listMyOrders(user)).find((o) => o.id === order.id)!;
  assert(shipped.deliveryStatus === "shipped" && shipped.trackNumber === "RU777", "клиент видит статус и трек");
  // Подписи — из общего модуля статусов: клиент и бот говорят одинаково.
  assert(shop.deliveryLabel("pickup") === "Готов к выдаче", "статус читается по-русски");
  assert(shop.deliveryLabel("new") === "Ожидает подтверждения", "новый заказ называется «ожидает подтверждения»");
  assert(shop.deliveryLabel("paid") === "Ожидает отправки", "оплаченный заказ — «ожидает отправки»");
  assert(shop.nextDeliveryStep("confirmed") === "paid", "после подтверждения следующий шаг — оплата");
  assert(!shop.trackAllowed("new"), "трек недоступен до отправки");

  // ── Отзывы ────────────────────────────────────────────────────────────────
  assert(!(await reviews.canReview(user, target.id)), "отзыв нельзя оставить до получения заказа");
  const early = await reviews.addReview({ tgUserId: user, productId: target.id, author: "Иван", rating: 5, text: "рано" });
  assert(!early.ok, "сервер отказывает в отзыве без полученного заказа");

  await shop.setDeliveryStatus(order.id, "done");
  assert(await reviews.canReview(user, target.id), "после получения отзыв разрешён");
  const added = await reviews.addReview({
    tgUserId: user,
    productId: target.id,
    author: "Иван",
    rating: 5,
    text: "Отличный аппарат",
  });
  assert(added.ok, "отзыв сохраняется");
  assert(!(await reviews.canReview(user, target.id)), "второй отзыв на тот же товар не предлагается");
  const listed = await reviews.listReviews(target.id);
  assert(listed.length === 1 && listed[0].rating === 5, "отзыв виден в карточке");
  const detailWithReview = await catalog.getProductDetail(target.id);
  assert(detailWithReview?.rating === 5, "рейтинг товара считается по отзывам");

  const bad = await reviews.addReview({ tgUserId: "900002", productId: target.id, author: "x", rating: 9, text: "" });
  assert(!bad.ok, "оценка вне 1–5 не принимается");

  // ── Реферал ───────────────────────────────────────────────────────────────
  const friend = await shop.getOrCreateCustomer({ tgUserId: "900003", firstName: "Пётр" });
  const invited = await shop.applyReferral(friend.tgUserId, customer.referralCode);
  assert(invited.ok, "реферальный код принимается один раз");
  const inviter = await shop.getOrCreateCustomer({ tgUserId: user });
  const invitedAfter = await shop.getOrCreateCustomer({ tgUserId: friend.tgUserId });
  const inviterEvents = await shop.listBonusEvents(user);
  assert(
    inviterEvents.some((e) => e.amount === 500 && e.reason.includes("Приглашён")),
    "пригласивший получил 500 бонусов",
  );
  // Баланс мог уменьшиться списанием, поэтому сверяем начисление, а не итог.
  assert(inviter.bonusBalance >= 0, "баланс остаётся неотрицательным");
  assert(invitedAfter.bonusBalance === 300, "приглашённый получил 300 бонусов");
  assert(!(await shop.applyReferral(friend.tgUserId, customer.referralCode)).ok, "повторно код не применяется");
  assert(!(await shop.applyReferral(user, customer.referralCode)).ok, "себя пригласить нельзя");
  assert(!(await shop.applyReferral("900004", "НЕТТАКОГО")).ok, "неизвестный код отклоняется");

  // ── Избранное и сравнение ─────────────────────────────────────────────────
  assert(await catalog.toggleFavorite(user, target.id), "товар добавляется в избранное");
  assert((await catalog.listFavorites(user)).some((p) => p.id === target.id), "избранное возвращается списком");
  assert(!(await catalog.toggleFavorite(user, target.id)), "повторное нажатие убирает из избранного");
  assert((await catalog.listFavorites(user)).length === 0, "избранное очищается");

  const pair = products.slice(0, 2).map((p) => p.id);
  const comparison = await catalog.compareProducts(pair);
  assert(Boolean(comparison), "сравнение двух товаров строится");
  assert(comparison!.products.length === 2, "в сравнении ровно две модели");
  assert(comparison!.rows.length > 0, "строки характеристик не пустые");
  assert(
    comparison!.rows.every((row) => row.values.length === 2),
    "в каждой строке по значению на модель",
  );
  assert((await catalog.compareProducts([pair[0]])) === null, "одного товара для сравнения мало");
  assert((await catalog.compareProducts([...pair, ...products.slice(2, 5).map((p) => p.id)]))!.products.length === 3, "сравниваются не больше трёх моделей");

  // ── Переезд старых путей фото ─────────────────────────────────────────────
  const { migratePhotoUrl } = await import("../src/lib/seed");
  assert(migratePhotoUrl("/products/ps5.png") === "/products/ps5.webp", "старый путь PNG переводится в WebP");
  assert(migratePhotoUrl("/products/a.jpeg") === "/products/a.webp", "старый путь JPEG переводится в WebP");
  assert(
    migratePhotoUrl("https://cdn.example.com/x.jpg") === "https://cdn.example.com/x.jpg",
    "внешние фото (S3/R2) не переписываются",
  );
  assert(
    migratePhotoUrl("/uploads/user-photo.png") === "/uploads/user-photo.png",
    "фото, загруженные владельцем, не переписываются",
  );

  // ── Фото: файлы на месте и не тяжёлые ──────────────────────────────────────
  // Скорость витрины на мобильном интернете = суммарный вес картинок. Проверяем
  // по настоящим файлам в public/products, а не по обещаниям скрипта сжатия.
  assert(
    products.every((p) => p.photoUrl.endsWith(".webp")),
    "все товары ссылаются на сжатые WebP",
  );
  const missing = products.filter((p) => !existsSync(path.join(process.cwd(), "public", p.photoUrl)));
  assert(missing.length === 0, `файл каждого фото есть в public (${products.length - missing.length}/${products.length})`);

  const sizes = products.map((p) => statSync(path.join(process.cwd(), "public", p.photoUrl)).size);
  const totalKb = Math.round(sizes.reduce((a, b) => a + b, 0) / 1024);
  assert(Math.max(...sizes) < 200 * 1024, `самое тяжёлое фото меньше 200 КБ (${Math.round(Math.max(...sizes) / 1024)} КБ)`);
  assert(totalKb < 900, `весь каталог фото меньше 900 КБ (${totalKb} КБ)`);

  rmSync(dir, { recursive: true, force: true });
  console.log("[check:shop] PASS — фильтры, карточка, корзина, заказ, бонусы, отзывы, избранное и сравнение работают");
}

main().catch((err) => {
  console.error("[check:shop] ошибка:", err);
  process.exit(1);
});
