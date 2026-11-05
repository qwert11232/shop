import { NextRequest, NextResponse } from "next/server";
import {
  answerCallback,
  editMessage,
  getFileUrl,
  sendMessage,
  type BotMessage,
  type BotUpdate,
  type BotUser,
} from "@/lib/bot-api";
import { adminsConfigured, isBotAdmin } from "@/lib/bot-access";
import {
  errorScreen,
  helpScreen,
  menuScreen,
  noAccessScreen,
  notConfiguredScreen,
  ordersScreen,
  orderStatusLabel,
  esc,
  type Screen,
} from "@/lib/bot-screens";
import {
  bonusAskScreen,
  categoryPickScreen,
  createdScreen,
  customerScreen,
  customersScreen,
  deleteConfirmScreen,
  draftFieldPrompt,
  draftScreen,
  galleryScreen,
  orderAdminScreen,
  productAdminScreen,
  productsListScreen,
  specsAskScreen,
  specsScreen,
  statsScreen,
  variantsAskScreen,
  variantsScreen,
  type Draft,
} from "@/lib/bot-screens-admin";
import { buildOrderMessage, notifyCustomer, userLabel } from "@/lib/telegram";
import { withDeliveryLine, withStatusLine } from "@/lib/order-message";
import {
  clearBotSession,
  countsForBot,
  getOrderById,
  getProductById,
  isOrderStatus,
  listCategoriesAdmin,
  listOrdersByStatus,
  listProductsAdmin,
  searchProductsAdmin,
  setBotSession,
  setOrderStatus,
  takeBotSession,
  updateProduct,
  type OrderStatus,
} from "@/lib/repo";
import {
  deliveryLabel,
  isDeliveryStatus,
  listCustomers,
  listOrderItems,
  setDeliveryStatus,
  getCustomer,
  listMyOrders,
  trackAllowed,
  customerStatusNotice,
} from "@/lib/shop";
import {
  addGalleryImage,
  addGalleryVideo,
  addSpecs,
  addVariants,
  applyBonus,
  applyCustomerPhone,
  applyDraftField,
  applyDraftText,
  applyOrderComment,
  applyProductField,
  createFromDraft,
  ensureCategory,
  parseDraft,
  removeProduct,
  removeSpec,
  removeVariant,
  serializeDraft,
  specsOf,
  variantsOf,
  setCover,
  setDraftCategory,
} from "@/lib/bot-admin-flow";
import { money, normalizeTrack, trackPromptScreen } from "@/lib/bot-screens";
import { countProductMedia } from "@/lib/repo";
import { storageDriver } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Webhook админ-бота ТЕХНОЛАД.
 *
 * Настройка: POST/GET /api/bot/setup — ставит webhook и команды меню.
 * Безопасность: Telegram присылает X-Telegram-Bot-Api-Secret-Token; без совпадения
 * с BOT_WEBHOOK_SECRET апдейт отклоняется.
 *
 * Логика разделена: этот файл разбирает апдейт и отправляет сообщения,
 * данные меняет `bot-admin-flow.ts`, тексты собирает `bot-screens*.ts`.
 * Сессия диалога (`bot_state`) нужна потому, что на Vercel инстансы сменяются:
 * «жду цену» из памяти пропадало бы при холодном старте.
 */

export async function POST(req: NextRequest) {
  const expected = process.env.BOT_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[bot] BOT_WEBHOOK_SECRET не задан — апдейты отклоняются");
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    console.warn("[bot] отклонён апдейт с неверным секретом");
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let update: BotUpdate;
  try {
    update = (await req.json()) as BotUpdate;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    if (update.callback_query) {
      await safe(update.callback_query.from, () => handleCallback(update));
    } else if (update.message?.from) {
      await safe(update.message.from, () => handleMessage(update.message!));
    }
  } catch (err) {
    // Telegram ретраит при не-200, поэтому отвечаем 200 всегда: причина уже в чате.
    console.error("[bot] обработка упала:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true });
}

async function safe(user: BotUser, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[bot] ошибка:", reason);
    if (!isBotAdmin(user)) return;
    const screen = errorScreen(reason);
    await sendMessage(user.id, screen.text, screen.keyboard);
  }
}

async function render(chatId: number, screen: Screen, messageId?: number) {
  if (messageId) {
    const edited = await editMessage(chatId, messageId, screen.text, screen.keyboard);
    // «message is not modified» — норма, когда нажали ту же кнопку.
    if (edited) return;
  }
  await sendMessage(chatId, screen.text, screen.keyboard);
}

// ─── Сообщения ─────────────────────────────────────────────────────────────

async function handleMessage(message: BotMessage): Promise<void> {
  const from = message.from!;
  const chatId = message.chat.id;
  const text = (message.text ?? "").trim();
  const command = text.split(/\s+/)[0]?.replace(/@.*$/, "").toLowerCase() ?? "";
  const chat = String(chatId);

  if (!adminsConfigured()) {
    const screen = notConfiguredScreen(from.id);
    await sendMessage(chatId, screen.text, screen.keyboard);
    return;
  }

  if (command === "/id") {
    await sendMessage(
      chatId,
      `Ваш Telegram ID: <code>${from.id}</code>\nИмя: ${esc(from.first_name)}${from.username ? ` @${esc(from.username)}` : ""}`,
    );
    return;
  }

  if (!isBotAdmin(from)) {
    const screen = noAccessScreen();
    await sendMessage(chatId, screen.text, screen.keyboard);
    return;
  }

  if (command === "/help") {
    await render(chatId, helpScreen());
    return;
  }

  // Фото от админа: обложка, кадр галереи или фото нового товара.
  const photo = message.photo?.[message.photo.length - 1];
  if (photo) {
    await handlePhoto(chatId, photo.file_id);
    return;
  }

  const waiting = await takeBotSession(chat);
  if (waiting && !text.startsWith("/")) {
    await handleSessionInput(chatId, waiting.kind, waiting.payload, text);
    return;
  }

  switch (command) {
    case "/start":
      await render(chatId, await menuScreen(await countsForBot()));
      return;
    case "/orders":
      await render(chatId, ordersScreen(await listOrdersByStatus("new", 10), "new"));
      return;
    case "/products":
      await render(chatId, productsListScreen(await listProductsAdmin(), 0));
      return;
    case "/new":
      await openDraft(chatId, {});
      return;
    case "/find":
      await askSearch(chatId);
      return;
    case "/stats":
      await render(chatId, await statsScreenFor());
      return;
    case "/customers":
      await render(chatId, customersScreen(await listCustomers(20)));
      return;
    default:
      await render(chatId, await menuScreen(await countsForBot()));
  }
}

async function statsScreenFor(): Promise<Screen> {
  const counts = await countsForBot();
  const customers = await listCustomers(200);
  const { orderTotals } = await import("@/lib/shop");
  const totals = await orderTotals();
  return statsScreen({
    orders: totals.orders,
    revenue: counts.revenueDone,
    newOrders: counts.newOrders,
    products: counts.products,
    activeProducts: counts.activeProducts,
    customers: customers.length,
    bonusIssued: totals.bonusIssued,
  });
}

// ─── Ввод текста в диалоге ─────────────────────────────────────────────────

async function handleSessionInput(chatId: number, kind: string, payload: string, text: string): Promise<void> {
  const chat = String(chatId);

  switch (kind) {
    // ── Черновик нового товара: текст заполняет первое пустое поле ──────────
    case "draft": {
      const draft = parseDraft(payload);
      const applied = await applyDraftText(draft, text);
      if (applied.needsCategory) {
        await setBotSession({ chatId: chat, kind: "draft", payload: serializeDraft(draft) });
        await render(chatId, draftScreen(draft));
        await render(chatId, draftFieldPrompt("category", await listCategoriesAdmin()));
        return;
      }
      if (applied.error) {
        await sendMessage(chatId, applied.error);
        await setBotSession({ chatId: chat, kind: "draft", payload: serializeDraft(draft) });
        return;
      }
      await openDraft(chatId, applied.draft);
      return;
    }

    // ── Правка поля товара ──────────────────────────────────────────────────
    case "edit": {
      const [productId, field] = payload.split(":");
      const result = await applyProductField(productId, field, text);
      if (!result.ok) {
        await sendMessage(chatId, `${result.error}\n\nПришлите значение ещё раз или нажмите /start.`);
        await setBotSession({ chatId: chat, kind: "edit", payload });
        return;
      }
      const product = result.product!;
      await render(chatId, {
        text: `<b>Сохранено.</b> ${fieldLabel(field)} обновлено.`,
        keyboard: { inline_keyboard: [[{ text: "К товару", callback_data: `product:${product.id}` }]] },
      });
      return;
    }

    // ── Трек-номер ─────────────────────────────────────────────────────────
    case "track": {
      const order = await getOrderById(payload);
      if (!order) {
        await sendMessage(chatId, "Заявка не найдена — возможно, её удалили.");
        return;
      }
      // Трек имеет смысл только у отправленного заказа: иначе клиент увидит
      // номер рядом со статусом «Ожидает оплаты» и решит, что посылка в пути.
      if (!trackAllowed(order.deliveryStatus)) {
        await clearBotSession(chat);
        await sendMessage(
          chatId,
          "Трек-номер ставится после отправки. Сначала переведите заказ в статус «Отправлено».",
        );
        await showOrder(chatId, order.id);
        return;
      }
      const track = normalizeTrack(text);
      if (!track) {
        await sendMessage(chatId, "Нужен трек-номер из 4–40 символов: латиница, цифры, дефис. Например: RU123456789.");
        await setBotSession({ chatId: chat, kind: "track", payload: order.id });
        return;
      }
      await setDeliveryStatus(order.id, isDeliveryStatus(order.deliveryStatus) ? order.deliveryStatus : "new", track);
      await showOrder(chatId, order.id);
      // Клиенту трек нужен сразу, а не когда он зайдёт в кабинет.
      const updated = await getOrderById(order.id);
      if (updated) {
        const notice = customerStatusNotice(updated);
        if (notice) await notifyCustomer(updated.tgUserId, notice);
      }
      return;
    }

    // ── Варианты и характеристики ──────────────────────────────────────────
    case "variants": {
      const { added, skipped } = await addVariants(payload, text);
      const product = await getProductById(payload);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      const variants = await variantsOf(payload);
      const screen = variantsScreen(product, variants);
      const tail = [
        "",
        added ? `<b>Добавлено вариантов: ${added}.</b>` : "<i>Ничего не добавлено.</i>",
        ...(skipped.length ? ["", `Не разобрал: ${skipped.map((s) => esc(s)).join(", ")}`] : []),
      ].join("\n");
      await sendMessage(chatId, `${screen.text}${tail}`, screen.keyboard);
      return;
    }

    case "specs": {
      const { added, skipped } = await addSpecs(payload, text);
      const product = await getProductById(payload);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      const screen = specsScreen(product, await specsOf(payload));
      const tail = [
        "",
        added ? `<b>Записано характеристик: ${added}.</b>` : "<i>Ничего не записано.</i>",
        ...(skipped.length ? ["", `Не разобрал: ${skipped.map((s) => esc(s)).join(", ")}`] : []),
      ].join("\n");
      await sendMessage(chatId, `${screen.text}${tail}`, screen.keyboard);
      return;
    }

    // ── Новая категория ────────────────────────────────────────────────────
    case "newcat": {
      const created = await ensureCategory(text);
      if (!created) {
        await sendMessage(chatId, "Нужно название от 2 символов. Пришлите ещё раз.");
        await setBotSession({ chatId: chat, kind: "newcat", payload: payload });
        return;
      }
      // Если пришли из черновика — сразу подставляем категорию.
      if (payload) {
        const draft = parseDraft(payload);
        const withCategory = { ...draft, categoryId: created.id, categoryName: created.name };
        await setBotSession({ chatId: chat, kind: "draft", payload: serializeDraft(withCategory) });
        await render(chatId, draftScreen(withCategory));
        return;
      }
      await render(chatId, {
        text: `<b>Категория создана:</b> ${esc(created.name)}`,
        keyboard: { inline_keyboard: [[{ text: "К товарам", callback_data: "products:0" }]] },
      });
      return;
    }

    // ── Поиск ──────────────────────────────────────────────────────────────
    case "search": {
      const found = await searchProductsAdmin(text, 10);
      const screen = productsListScreen(found, 0, text.slice(0, 40));
      await sendMessage(chatId, screen.text, screen.keyboard);
      return;
    }

    // ── Отдельные поля черновика ───────────────────────────────────────────
    case "draftField": {
      const [field, draftJson] = splitOnce(payload, "|");
      const draft = parseDraft(draftJson);
      const applied = await applyDraftField(draft, field, text);
      if (applied.error) {
        await sendMessage(chatId, `${applied.error}`);
        await setBotSession({ chatId: chat, kind: "draftField", payload });
        return;
      }
      await openDraft(chatId, applied.draft);
      return;
    }

    // ── Видео в галерею ────────────────────────────────────────────────────
    case "galvideo": {
      const result = await addGalleryVideo(payload, text);
      if (!result.ok) {
        await sendMessage(chatId, result.error!);
        await setBotSession({ chatId: chat, kind: "galvideo", payload });
        return;
      }
      const product = await getProductById(payload);
      if (product) await render(chatId, galleryScreen(product, await countProductMedia(payload)));
      return;
    }

    // ── Комментарий к заказу ───────────────────────────────────────────────
    case "ocomment": {
      const result = await applyOrderComment(payload, text);
      if (!result.ok) {
        await sendMessage(chatId, "Комментарий слишком короткий — минимум 2 символа.");
        await setBotSession({ chatId: chat, kind: "ocomment", payload });
        return;
      }
      await showOrder(chatId, payload);
      return;
    }

    // ── Телефон клиента ────────────────────────────────────────────────────
    case "phone": {
      const result = await applyCustomerPhone(payload, text);
      if (!result.ok) {
        await sendMessage(chatId, "Нужен телефон: 10–15 цифр. Например <code>+7 900 000-00-00</code>.");
        await setBotSession({ chatId: chat, kind: "phone", payload });
        return;
      }
      await showCustomer(chatId, payload);
      return;
    }

    // ── Бонусы ─────────────────────────────────────────────────────────────
    case "bonus": {
      const result = await applyBonus(payload, text);
      if (!result.ok) {
        await sendMessage(chatId, result.error!);
        await setBotSession({ chatId: chat, kind: "bonus", payload });
        return;
      }
      await sendMessage(chatId, `Готово. Новый баланс: <b>${money(result.balance ?? 0)}</b>.`);
      await showCustomer(chatId, payload);
      return;
    }

    default:
      await sendMessage(chatId, "Не понял шаг. Откройте /start и начните заново.");
      await clearBotSession(chat);
  }
}

/** Черновик: показать карточку и запомнить состояние между шагами. */
async function openDraft(chatId: number, draft: Draft, message?: string): Promise<void> {
  await setBotSession({ chatId: String(chatId), kind: "draft", payload: serializeDraft(draft) });
  const screen = draftScreen(draft);
  await sendMessage(chatId, message ? `${message}\n\n${screen.text}` : screen.text, screen.keyboard);
}

/** Запрос текста для шага черновика: сессия «draftField|<field>|<json>». */
async function askDraftField(chatId: number, draft: Draft, field: string): Promise<void> {
  const categories = field === "category" ? await listCategoriesAdmin() : [];
  const prompt = draftFieldPrompt(field, categories);
  if (field === "category") {
    await setBotSession({ chatId: String(chatId), kind: "draft", payload: serializeDraft(draft) });
    await sendMessage(chatId, prompt.text, prompt.keyboard);
    return;
  }
  await setBotSession({
    chatId: String(chatId),
    kind: "draftField",
    payload: `${field}|${serializeDraft(draft)}`,
  });
  await sendMessage(chatId, prompt.text, prompt.keyboard);
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    title: "Название",
    price: "Цена",
    brand: "Бренд",
    desc: "Описание",
    photo: "Фото",
  };
  return labels[field] ?? "Поле";
}

function splitOnce(value: string, separator: string): [string, string] {
  const at = value.indexOf(separator);
  return at === -1 ? [value, ""] : [value.slice(0, at), value.slice(at + 1)];
}

// ─── Фото ──────────────────────────────────────────────────────────────────

async function handlePhoto(chatId: number, fileId: string): Promise<void> {
  const chat = String(chatId);
  const waiting = await takeBotSession(chat);
  const kind = waiting?.kind ?? "";
  const payload = waiting?.payload ?? "";

  if (!["cover", "gallery", "draftPhoto"].includes(kind)) {
    await sendMessage(
      chatId,
      "Фото получено, но не выбрано, куда его поставить. Откройте товар → «Фото» или «Галерея».",
    );
    return;
  }

  if (!storageDriver()) {
    await sendMessage(
      chatId,
      [
        "Хранилище фото не настроено: на сервере нет S3_BUCKET и ключей S3.",
        "",
        "Без него файл некуда сохранить — на Vercel запись на диск запрещена.",
        "Задайте S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (и S3_ENDPOINT для R2) и пришлите фото снова.",
      ].join("\n"),
    );
    return;
  }

  const fileUrl = await getFileUrl(fileId);
  if (!fileUrl) {
    await sendMessage(chatId, "Не удалось получить файл из Telegram. Попробуйте ещё раз.");
    await setBotSession({ chatId: chat, kind, payload });
    return;
  }

  const res = await fetch(fileUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    await sendMessage(chatId, `Telegram не отдал файл (${res.status}). Попробуйте ещё раз.`);
    return;
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > 8 * 1024 * 1024) {
    await sendMessage(chatId, "Файл больше 8 МБ — сожмите и пришлите снова.");
    return;
  }

  const { saveImage } = await import("@/lib/storage");
  const stored = await saveImage({ body, contentType: "image/jpeg", ext: ".jpg" });

  if (kind === "draftPhoto") {
    const draft = parseDraft(payload);
    const next = { ...draft, photoUrl: stored.url };
    await openDraft(chatId, next, "<b>Фото добавлено.</b>");
    return;
  }

  if (kind === "cover") {
    const updated = await setCover(payload, stored.url);
    if (!updated) {
      await sendMessage(chatId, "Товар не найден.");
      return;
    }
    const withCategory = await productWithCategory(updated.id);
    if (withCategory) await render(chatId, productAdminScreen(withCategory));
    return;
  }

  await addGalleryImage(payload, stored.url);
  const product = await getProductById(payload);
  if (product) {
    await render(chatId, galleryScreen(product, await countProductMedia(payload)));
  }
}

// ─── Кнопки ────────────────────────────────────────────────────────────────

async function handleCallback(update: BotUpdate): Promise<void> {
  const query = update.callback_query!;
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const data = query.data ?? "";
  const chat = String(chatId);

  if (!isBotAdmin(query.from)) {
    await answerCallback(query.id, "Раздел доступен владельцу магазина");
    return;
  }
  if (!chatId || !messageId) {
    await answerCallback(query.id);
    return;
  }

  // Делим по первому двоеточию: id товаров и заказов содержат дефисы.
  const [action, arg = ""] = splitOnce(data, ":");

  switch (action) {
    case "menu":
      await answerCallback(query.id);
      await render(chatId, await menuScreen(await countsForBot()), messageId);
      return;

    case "stats":
      await answerCallback(query.id);
      await render(chatId, await statsScreenFor(), messageId);
      return;

    // ── Заказы ─────────────────────────────────────────────────────────────
    case "orders": {
      await answerCallback(query.id);
      const filter = arg || "new";
      const orders = await listOrdersByStatus(filter === "all" ? "new" : (filter as OrderStatus), 10);
      await render(chatId, ordersScreen(orders, filter), messageId);
      return;
    }

    case "order": {
      await answerCallback(query.id);
      await showOrder(chatId, arg, messageId);
      return;
    }

    case "status": {
      const [orderId, next] = arg.split(":");
      if (!isOrderStatus(next)) {
        await answerCallback(query.id, "Неизвестный статус");
        return;
      }
      const ok = await setOrderStatus(orderId, next);
      if (!ok) {
        await answerCallback(query.id, "Заявка не найдена");
        return;
      }
      const order = await getOrderById(orderId);
      await answerCallback(query.id, `Статус: ${order ? orderStatusLabel(order.status) : next}`);
      if (order) {
        await showOrder(chatId, orderId, messageId);
        await syncGroupStatus(order, next, query.from.first_name);
      }
      return;
    }

    case "delivery": {
      const [orderId, next] = arg.split(":");
      if (!isDeliveryStatus(next)) {
        await answerCallback(query.id, "Неизвестный статус доставки");
        return;
      }
      const ok = await setDeliveryStatus(orderId, next);
      if (!ok) {
        await answerCallback(query.id, "Заявка не найдена");
        return;
      }
      const order = await getOrderById(orderId);
      await answerCallback(query.id, `Статус: ${deliveryLabel(next)}`);
      if (order) {
        await showOrder(chatId, orderId, messageId);
        await syncGroupStatus(order, (order.status as OrderStatus) ?? "new", query.from.first_name, next);
        // Клиент получает сообщение на каждый шаг: он уже вышел из Mini App.
        const notice = customerStatusNotice(order);
        if (notice) {
          const delivered = await notifyCustomer(order.tgUserId, notice);
          if (!delivered) {
            await answerCallback(query.id, "Клиенту не отправлено: бот заблокирован или ID нет", true);
          }
        }
      }
      return;
    }

    case "track": {
      const order = await getOrderById(arg);
      await answerCallback(query.id);
      if (!order) {
        await sendMessage(chatId, "Заявка не найдена.");
        return;
      }
      if (!trackAllowed(order.deliveryStatus)) {
        await answerCallback(query.id, "Сначала отметьте «Отправлено»", true);
        await sendMessage(chatId, "Трек-номер ставится после отправки: сначала нажмите «Отправлено».");
        return;
      }
      await render(chatId, trackPromptScreen(order), messageId);
      await setBotSession({ chatId: chat, kind: "track", payload: order.id });
      return;
    }

    case "ocomment": {
      const order = await getOrderById(arg);
      await answerCallback(query.id);
      if (!order) {
        await sendMessage(chatId, "Заявка не найдена.");
        return;
      }
      await setBotSession({ chatId: chat, kind: "ocomment", payload: order.id });
      await sendMessage(
        chatId,
        "Пришлите комментарий к заказу одним сообщением — клиент увидит его в кабинете.\nНапример, причину отмены или время доставки.",
      );
      return;
    }

    // ── Товары ─────────────────────────────────────────────────────────────
    case "products": {
      await answerCallback(query.id);
      await render(chatId, productsListScreen(await listProductsAdmin(), Number(arg || 0)), messageId);
      return;
    }

    case "find": {
      if (arg === "ask") {
        await answerCallback(query.id);
        await askSearch(chatId);
        return;
      }
      await answerCallback(query.id);
      await render(chatId, productsListScreen(await listProductsAdmin(), Number(arg || 0)), messageId);
      return;
    }

    case "product": {
      await answerCallback(query.id);
      const product = await productWithCategory(arg);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      await render(chatId, productAdminScreen(product), messageId);
      return;
    }

    case "toggle": {
      const product = await getProductById(arg);
      if (!product) {
        await answerCallback(query.id, "Товар не найден");
        return;
      }
      const updated = await updateProduct(arg, { isActive: !product.isActive });
      await answerCallback(query.id, updated?.isActive ? "На витрине" : "Скрыт");
      const withCategory = await productWithCategory(arg);
      if (withCategory) await render(chatId, productAdminScreen(withCategory), messageId);
      return;
    }

    case "del": {
      await answerCallback(query.id);
      const product = await getProductById(arg);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      await render(chatId, deleteConfirmScreen(product), messageId);
      return;
    }

    case "delok": {
      const removed = await removeProduct(arg);
      await answerCallback(query.id, removed ? "Удалено" : "Товар не найден");
      await render(chatId, productsListScreen(await listProductsAdmin(), 0), messageId);
      return;
    }

    case "cat": {
      const [productId, categoryId] = arg.split(":");
      if (!categoryId) {
        await answerCallback(query.id);
        await render(chatId, categoryPickScreen(productId, await listCategoriesAdmin()), messageId);
        return;
      }
      const ok = await updateProduct(productId, { categoryId });
      await answerCallback(query.id, ok ? "Категория обновлена" : "Не удалось");
      if (ok) {
        const product = await productWithCategory(productId);
        if (product) await render(chatId, productAdminScreen(product), messageId);
      }
      return;
    }

    case "catnew": {
      await answerCallback(query.id);
      // Если в сессии лежит черновик — категория нужна ему, иначе — просто создаём.
      const session = await takeBotSession(chat);
      const payload = session?.kind === "draft" ? session.payload : "";
      await setBotSession({ chatId: chat, kind: "newcat", payload });
      await sendMessage(
        chatId,
        "Пришлите название новой категории одним сообщением — например, «Умный дом». Оно сразу появится в витрине.",
      );
      return;
    }

    case "edit": {
      const [productId, field] = arg.split(":");
      const product = await getProductById(productId);
      await answerCallback(query.id);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      if (field === "photo") {
        await setBotSession({ chatId: chat, kind: "cover", payload: productId });
        await render(chatId, {
          text: [
            "<b>Фото товара</b>",
            "",
            "Пришлите фото одним сообщением — оно станет обложкой карточки и первым кадром галереи.",
            "Формат: jpg или png, до 8 МБ.",
          ].join("\n"),
          keyboard: { inline_keyboard: [[{ text: "‹ Отмена", callback_data: `product:${productId}` }]] },
        }, messageId);
        return;
      }
      await render(chatId, draftFieldPromptForEdit(productId, field), messageId);
      await setBotSession({ chatId: chat, kind: "edit", payload: `${productId}:${field}` });
      return;
    }

    // ── Варианты ───────────────────────────────────────────────────────────
    case "variants": {
      await answerCallback(query.id);
      const product = await getProductById(arg);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      await render(chatId, variantsScreen(product, await variantsOf(arg)), messageId);
      return;
    }

    case "varadd": {
      const product = await getProductById(arg);
      await answerCallback(query.id);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      await render(chatId, variantsAskScreen(product), messageId);
      await setBotSession({ chatId: chat, kind: "variants", payload: arg });
      return;
    }

    case "vardel": {
      const [productId, variantId] = arg.split(":");
      const ok = await removeVariant(productId, variantId);
      await answerCallback(query.id, ok ? "Удалено" : "Не найдено");
      const product = await getProductById(productId);
      if (product) await render(chatId, variantsScreen(product, await variantsOf(productId)), messageId);
      return;
    }

    // ── Характеристики ─────────────────────────────────────────────────────
    case "specs": {
      await answerCallback(query.id);
      const product = await getProductById(arg);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      await render(chatId, specsScreen(product, await specsOf(arg)), messageId);
      return;
    }

    case "specadd": {
      const product = await getProductById(arg);
      await answerCallback(query.id);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      await render(chatId, specsAskScreen(product), messageId);
      await setBotSession({ chatId: chat, kind: "specs", payload: arg });
      return;
    }

    case "specdel": {
      const [productId, ...rest] = arg.split(":");
      const ok = await removeSpec(productId, rest.join(":"));
      await answerCallback(query.id, ok ? "Удалено" : "Не найдено");
      const product = await getProductById(productId);
      if (product) await render(chatId, specsScreen(product, await specsOf(productId)), messageId);
      return;
    }

    // ── Галерея ────────────────────────────────────────────────────────────
    case "gallery": {
      if (arg === "back") {
        await answerCallback(query.id);
        return;
      }
      await answerCallback(query.id);
      const product = await getProductById(arg);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      await render(chatId, galleryScreen(product, await countProductMedia(arg)), messageId);
      return;
    }

    case "galadd": {
      await answerCallback(query.id);
      await sendMessage(chatId, "Пришлите фото одним сообщением — добавлю его в галерею.");
      await setBotSession({ chatId: chat, kind: "gallery", payload: arg });
      return;
    }

    case "galvideo": {
      await answerCallback(query.id);
      await sendMessage(chatId, "Пришлите ссылку на видео (mp4, webm или mov) — вставлю плеером в галерею.");
      await setBotSession({ chatId: chat, kind: "galvideo", payload: arg });
      return;
    }

    // ── Новый товар ────────────────────────────────────────────────────────
    case "add": {
      if (arg === "new") {
        await answerCallback(query.id);
        await openDraft(chatId, {});
        return;
      }
      const session = await takeBotSession(chat);
      const draft = session?.kind === "draft" ? parseDraft(session.payload) : {};
      if (arg.startsWith("cat:")) {
        const applied = await setDraftCategory(draft, arg.slice(4));
        await answerCallback(query.id, applied.error ?? "Категория выбрана");
        await openDraft(chatId, applied.draft);
        return;
      }
      if (arg === "create") {
        const created = await createFromDraft(draft);
        if (!created.ok || !created.product) {
          await answerCallback(query.id, "Не хватает данных");
          await openDraft(chatId, draft, `<b>Не получилось:</b> ${esc(created.error ?? "")}`);
          return;
        }
        await answerCallback(query.id, "Товар создан");
        await clearBotSession(chat);
        const product = created.product;
        await render(
          chatId,
          createdScreen(product, { variants: 0 }),
          messageId,
        );
        return;
      }
      if (arg === "category") {
        await answerCallback(query.id);
        await setBotSession({ chatId: chat, kind: "draft", payload: serializeDraft(draft) });
        const prompt = draftFieldPrompt("category", await listCategoriesAdmin());
        await render(chatId, prompt, messageId);
        return;
      }
      if (arg === "photo") {
        await answerCallback(query.id);
        await setBotSession({ chatId: chat, kind: "draftPhoto", payload: serializeDraft(draft) });
        await render(chatId, draftFieldPrompt("photo"), messageId);
        return;
      }
      // Остальные поля — обычный ввод текстом.
      await answerCallback(query.id);
      await askDraftField(chatId, draft, arg);
      return;
    }

    // ── Покупатели и бонусы ────────────────────────────────────────────────
    case "customers": {
      await answerCallback(query.id);
      await render(chatId, customersScreen(await listCustomers(20)), messageId);
      return;
    }

    case "cust": {
      await answerCallback(query.id);
      await showCustomer(chatId, arg, messageId);
      return;
    }

    case "bonus": {
      const customer = await getCustomer(arg);
      await answerCallback(query.id);
      if (!customer) {
        await sendMessage(chatId, "Покупатель не найден.");
        return;
      }
      await render(chatId, bonusAskScreen(arg, customer.bonusBalance), messageId);
      await setBotSession({ chatId: chat, kind: "bonus", payload: arg });
      return;
    }

    default:
      await answerCallback(query.id);
      await clearBotSession(chat);
      await render(chatId, await menuScreen(await countsForBot()), messageId);
  }
}

// ─── Вспомогательные экраны ────────────────────────────────────────────────

async function productWithCategory(id: string) {
  const products = await listProductsAdmin();
  return products.find((p) => p.id === id) ?? null;
}

async function showOrder(chatId: number, orderId: string, messageId?: number) {
  const order = await getOrderById(orderId);
  if (!order) {
    await sendMessage(chatId, "Заявка не найдена.");
    return;
  }
  const items = await listOrderItems(orderId);
  const screen = orderAdminScreen(order, items);
  if (messageId) await render(chatId, screen, messageId);
  else await sendMessage(chatId, screen.text, screen.keyboard);
}

async function showCustomer(chatId: number, tgUserId: string, messageId?: number) {
  const customer = await getCustomer(tgUserId);
  const orders = customer ? (await listMyOrders(tgUserId)).length : 0;
  const screen = customerScreen(customer ? { ...customer, ordersCount: orders, lastOrderAt: null } : null, orders);
  if (messageId) await render(chatId, screen, messageId);
  else await sendMessage(chatId, screen.text, screen.keyboard);
}

async function askSearch(chatId: number) {
  await setBotSession({ chatId: String(chatId), kind: "search", payload: "" });
  await sendMessage(
    chatId,
    "Пришлите часть названия или бренд — найду товары. Например: <code>iPhone</code> или <code>Dyson</code>.",
  );
}

function draftFieldPromptForEdit(productId: string, field: string): Screen {
  const cancel = { inline_keyboard: [[{ text: "‹ Отмена", callback_data: `product:${productId}` }]] };
  const texts: Record<string, string> = {
    title: "<b>Название</b>\n\nПришлите новое название — до 120 символов.",
    price: "<b>Цена</b>\n\nПришлите цену в рублях, целое число. Например: <code>89 990</code>.",
    brand: "<b>Бренд</b>\n\nПришлите бренд одним словом. Пустое значение очистит поле — тогда фильтр по бренду его не покажет.",
    desc: "<b>Описание</b>\n\nПришлите текст от 10 символов — что важно знать покупателю.",
  };
  return { text: texts[field] ?? "Пришлите новое значение.", keyboard: cancel };
}

// ─── Синхронизация сообщения в группе ──────────────────────────────────────

async function syncGroupStatus(
  order: Awaited<ReturnType<typeof getOrderById>>,
  status: OrderStatus,
  actor: string,
  delivery?: string,
): Promise<void> {
  // Сообщение о заказе могло уйти в личку админа (когда группы ещё нет) —
  // тогда правим его там же, chat_id совпадает с получателем заказа.
  if (!order?.groupMessageId) return;
  const target = process.env.GROUP_CHAT_ID?.trim();
  const chatId = target && target !== "me" ? target : (process.env.ADMIN_TELEGRAM_IDS ?? "").split(",")[0]?.trim();
  if (!chatId) return;
  const product = await getProductById(order.productId);
  if (!product) return;
  const base = buildOrderMessage({
    productTitle: product.title,
    priceKopecks: product.price,
    userLabel: userLabel({
      id: Number(order.tgUserId ?? 0),
      first_name: order.firstName ?? "Гость",
      username: order.username ?? undefined,
    }),
    comment: order.comment,
    date: new Date(order.createdAt.includes("T") ? order.createdAt : `${order.createdAt.replace(" ", "T")}Z`),
  });
  await editMessage(
    chatId,
    Number(order.groupMessageId),
    delivery ? withDeliveryLine(base, deliveryLabel(delivery), actor) : withStatusLine(base, status, actor),
  );
}
