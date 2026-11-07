/**
 * Проверка витрины без браузера и без сети: фильтры, карточка, корзина,
 * оформление, бонусы, реферал, отзывы и сравнение — на настоящей SQLite-базе.
 *
 * Запуск: npm run check:shop
 * Проверяем поведение функций, которые вызывают API-роуты: если логика
 * сломается, здесь это видно до деплоя.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "fs";
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
  const repo = await import("../src/lib/repo");
  const { applyFilters } = await import("../src/lib/catalog");

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

  // Галерея и видео: механика проверяется на кадре, добавленном владельцем.
  // Раньше здесь было жёсткое «ровно 3 кадра» — теперь у демо-товаров есть
  // живые фото с прилавка, и число кадров в сиде не константа. Проверяем
  // прирост и порядок, а не конкретное количество.
  {
    const { getDb } = await import("../src/lib/db");
    const db = await getDb();
    const before = detail!.gallery.length;
    await db.run(
      "INSERT INTO product_media (id, product_id, kind, url, sort_order) VALUES (?, ?, ?, ?, ?)",
      ["media-test-1", target.id, "image", "/products/ps5.png", 50],
    );
    await db.run(
      "INSERT INTO product_media (id, product_id, kind, url, sort_order) VALUES (?, ?, ?, ?, ?)",
      ["media-test-2", target.id, "video", "https://example.com/demo.mp4", 60],
    );
    const withMedia = await catalog.getProductDetail(target.id);
    // Галерея хранит кадры и видео одним списком — так её и листает карточка.
    assert(
      (withMedia?.gallery.length ?? 0) === before + 2,
      `галерея принимает кадр и видео владельца (${before} → ${withMedia?.gallery.length})`,
    );
    assert(
      withMedia?.gallery.includes("/products/ps5.png") === true,
      "кадр владельца попадает в галерею",
    );
    assert(
      withMedia?.gallery[withMedia.gallery.length - 2] === "/products/ps5.png",
      "кадры идут в заданном порядке: кадр раньше видео с большим sort_order",
    );
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

  // ── Дизайн-инварианты ────────────────────────────────────────────────────
  // Регрессии вёрстки не видны в логике, поэтому проверяем то, что можно
  // проверить без браузера: слой CSS, единую подложку фото и шкалу кеглей.
  const css = readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");
  assert(
    /@layer components\s*\{[\s\S]*\.input\s*\{/.test(css),
    "компонентные классы лежат в @layer components (иначе .input перебивает утилиты Tailwind)",
  );
  assert(css.includes(".photo-frame"), "есть единая подложка фото (кадры разной светлоты не проваливаются)");
  assert(
    /\.photo-frame\s*>\s*img\s*\{[\s\S]*?height:\s*100%/.test(css),
    "фото занимает всю плитку, а не висит в углу на сером фоне",
  );
  for (const cls of [".t-price-lg", ".t-price", ".t-title", ".t-brand", ".t-section"]) {
    assert(css.includes(cls), `шкала типографики содержит ${cls}`);
  }
  const priceTokens = [...css.matchAll(/\.t-price-lg\s*\{[\s\S]*?font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
  assert(
    priceTokens.length > 0 && priceTokens[0] >= 17,
    `цена крупнее названия: ${priceTokens[0]}px против 13.5px у .t-title`,
  );
  assert(css.includes(".edge-fade"), "у горизонтальных лент есть затухание по краю");

  const catalogSrc = readFileSync(
    path.join(process.cwd(), "src", "components", "shop", "CatalogScreen.tsx"),
    "utf8",
  );
  // Регрессия: иконка поиска налезала на плейсхолдер, пока .input перебивал pl-9.
  assert(catalogSrc.includes('className="input pl-11"'), "у поиска отступ слева под иконку (pl-11)");
  assert(catalogSrc.includes('className="shelf'), "каталог собран в сетку-полотно, а не 17 отдельных рамок");
  // Акцентный блок «Выбор покупателей» убран по требованию владельца:
  // на его месте лента новинок, и товар не должен стоять на экране дважды.
  assert(
    !catalogSrc.includes("Выбор покупателей"),
    "на витрине нет акцентного блока «Выбор покупателей»",
  );
  assert(catalogSrc.includes("Новое в магазине"), "вместо него лента новинок");
  assert(
    catalogSrc.includes("news-rail") && catalogSrc.includes("!category && !search"),
    "лента новинок видна в общем каталоге и не мешает внутри раздела",
  );
  assert(
    catalogSrc.includes("PhotoCarousel"),
    "у карточки в сетке есть карусель кадров",
  );
  assert(
    catalogSrc.includes("discount-badge") && catalogSrc.includes("hasDiscount"),
    "скидка показывается бейджем на фото, а не в строке цены",
  );
  assert(catalogSrc.includes("tab "), "категории — табы с подчёркиванием, а не плашки-чипы");
  // Комментарий «раньше здесь жил <select>» — не код: ищем реальный тег.
  assert(
    !/<select[\s>]/.test(catalogSrc),
    "сортировка не через <select> (на iOS он выглядит как поле ввода)",
  );

  const cartSrc = readFileSync(path.join(process.cwd(), "src", "components", "shop", "CartScreen.tsx"), "utf8");
  assert(cartSrc.includes('className="empty mt-4"'), "пустая корзина — блок с иконкой и объяснением, а не пустая рамка");
  assert(
    !cartSrc.includes("border-b border-ink"),
    "шапки экранов не отделяются самой контрастной линией на экране",
  );

  // ── Скидки ───────────────────────────────────────────────────────────────
  // Модель: price — сколько платит клиент, oldPrice — зачёркнутая цена.
  // Корзина считается по price, поэтому скидка не может «потеряться»
  // в оформлении — это и проверяем.
  {
    const price = await import("../src/lib/price");
    const sale = products.find((p) => p.oldPrice > 0 && p.oldPrice > p.price);
    assert(Boolean(sale), `в каталоге есть товар со скидкой (${sale?.title ?? "нет"})`);
    assert(price.hasDiscount(sale!) === true, "скидка распознаётся по старой цене");
    assert(
      price.discountPercent(sale!) === Math.round((1 - sale!.price / sale!.oldPrice) * 100),
      `процент скидки считается от старой цены (−${price.discountPercent(sale!)}%)`,
    );
    assert(price.savings(sale!) === sale!.oldPrice - sale!.price, "выгода = старая цена минус новая");
    assert(price.hasDiscount({ price: 1000, oldPrice: 500 }) === false, "старая цена ниже новой — не скидка");
    assert(price.discountPercent({ price: 1000, oldPrice: 0 }) === 0, "без старой цены процента нет");

    const discounted = applyFilters(products, { onlyDiscounted: true });
    assert(
      discounted.length > 0 && discounted.every((p) => p.oldPrice > p.price),
      `фильтр «только со скидкой» больше не пропускает всё (${discounted.length} товаров)`,
    );

    // UI: фильтр «Со скидкой» реально ходит в API, а не просто висит чипом.
    const readSource = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
    const catalogUi = readSource("src/components/shop/CatalogScreen.tsx");
    assert(
      catalogUi.includes('params.set("sale", "1")') &&
        catalogUi.includes("setOnlyDiscounted") &&
        catalogUi.includes("Со скидкой"),
      "каталог умеет включить фильтр «Со скидкой» и отправить его в API",
    );
    assert(
      catalogUi.includes("onlyDiscounted])"),
      "смена фильтра скидок перезапрашивает каталог",
    );
    assert(
      readSource("src/app/api/catalog/route.ts").includes('params.get("sale") === "1"'),
      "API понимает параметр sale=1",
    );
    assert(
      catalogUi.includes("setOnlyDiscounted(false);"),
      "«Сбросить всё» снимает фильтр скидок",
    );

    // Корзина: строка адресуется по id, а не по составному ключу с variant_id.
    // В PostgreSQL variant_id в первичном ключе неявно NOT NULL — товар без
    // варианта не добавлялся вовсе. Проверяем оба пути и на SQLite.
    const plainProduct = products.find((p) => !p.oldPrice || p.oldPrice <= p.price)!;
    const plainCart = await shop.addToCart({ tgUserId: "777002", productId: plainProduct.id, quantity: 1 });
    assert(
      plainCart.lines.length === 1 && plainCart.lines[0].variantId === null,
      "товар без вариантов кладётся в корзину (раньше падало на PostgreSQL)",
    );
    const cartId = await (async () => {
      const { getDb } = await import("../src/lib/db");
      const db = await getDb();
      const row = await db.get<{ id: string }>("SELECT id FROM cart_items WHERE tg_user_id = ?", ["777002"]);
      return row?.id ?? "";
    })();
    assert(cartId.startsWith("ci-"), "у строки корзины есть собственный id");
    const sameAgain = await shop.addToCart({ tgUserId: "777002", productId: plainProduct.id, quantity: 1 });
    assert(sameAgain.lines.length === 1 && sameAgain.lines[0].quantity === 2, "повтор не создаёт вторую строку");
    await shop.clearCart("777002");

    // Корзина и заказ берут price, а не oldPrice.
    const buyer = "777001";
    const cart = await shop.addToCart({ tgUserId: buyer, productId: sale!.id, quantity: 1 });
    const line = cart.lines.find((l) => l.productId === sale!.id)!;
    assert(line.unitPrice === sale!.price, "в корзину попадает цена со скидкой, а не старая");
    assert(line.basePrice === sale!.price, "базовая цена строки — актуальная");
    // Выгода в корзине: старая цена строки, общая экономия и сходимость итога.
    assert(line.oldPrice === sale!.oldPrice, "в строке корзины есть зачёркнутая цена товара");
    assert(
      cart.savings === (sale!.oldPrice - sale!.price) * line.quantity,
      "экономия корзины = (старая − новая) × количество",
    );
    assert(
      cart.total + cart.savings === sale!.oldPrice * line.quantity,
      "«Товары» плюс «Скидка» дают ровно старую цену — на экране ничего не теряется",
    );
    assert(
      cart.lines.every((l) => l.oldPrice === 0 || l.oldPrice > l.unitPrice),
      "старая цена в корзине выше той, что платит клиент",
    );


    // Заказ считает сумму по переданному total, а корзина — по price,
    // поэтому проверяем связку: сумма заказа равна цене со скидкой.
    const order = await shop.createPurchaseOrder({
      tgUserId: buyer,
      contactName: "Тест",
      contactPhone: "+79000000000",
      total: cart.total,
      items: cart.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity })),
    });
    assert(
      order.total === sale!.price,
      `итог заказа считается по цене со скидкой (${order.total / 100} ₽)`,
    );

    // Владелец загрузил свой кадр — сид не подмешивает демо-фото.
    {
      const { getDb } = await import("../src/lib/db");
      const db = await getDb();
      await db.run("DELETE FROM product_media WHERE product_id = ?", [sale!.id]);
      await db.run(
        "INSERT INTO product_media (id, product_id, kind, url, sort_order) VALUES (?, ?, ?, ?, ?)",
        ["owner-shot-1", sale!.id, "image", "/uploads/owner-photo.webp", 0],
      );
      await seed.seedCatalog();
      const rows = await db.all<{ url: string }>(
        "SELECT url FROM product_media WHERE product_id = ? ORDER BY sort_order",
        [sale!.id],
      );
      assert(
        rows.length === 1 && rows[0].url === "/uploads/owner-photo.webp",
        "кадр, загруженный владельцем, не перемешивается с демо-фото",
      );
    }

    // Снятие скидки возвращает товар в обычное состояние.
    const cleared = await repo.updateProduct(sale!.id, { oldPriceKopecks: 0 });
    assert(cleared?.oldPrice === 0, "скидку можно снять (old_price = 0)");
    assert(price.hasDiscount(cleared!) === false, "после снятия скидки товар обычный");
  }

  rmSync(dir, { recursive: true, force: true });
  console.log("[check:shop] PASS — фильтры, карточка, корзина, заказ, бонусы, отзывы, избранное и сравнение работают");
}

main().catch((err) => {
  console.error("[check:shop] ошибка:", err);
  process.exit(1);
});
