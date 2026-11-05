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
  fieldPrompt,
  helpScreen,
  menuScreen,
  noAccessScreen,
  notConfiguredScreen,
  orderCardScreen,
  ordersScreen,
  normalizeTrack,
  productCardScreen,
  productsScreen,
  savedScreen,
  trackPromptScreen,
  esc,
  type Screen,
} from "@/lib/bot-screens";
import { buildOrderMessage, userLabel } from "@/lib/telegram";
import { deliveryLabel, isDeliveryStatus, setDeliveryStatus } from "@/lib/shop";
import { withDeliveryLine, withStatusLine } from "@/lib/order-message";
import {
  clearBotSession,
  countsForBot,
  getOrderById,
  getProductById,
  isOrderStatus,
  listOrdersByStatus,
  listProductsAdmin,
  setBotSession,
  setOrderStatus,
  takeBotSession,
  updateProduct,
  type OrderStatus,
} from "@/lib/repo";
import { storageDriver } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Webhook админ-бота ТЕХНОЛАБ.
 *
 * Настройка: POST/GET /api/bot/setup — ставит webhook и команды меню.
 * Безопасность: Telegram присылает X-Telegram-Bot-Api-Secret-Token; без совпадения
 * с BOT_WEBHOOK_SECRET апдейт отклоняется, иначе кто угодно мог бы изобразить
 * админа. Права проверяются только на сервере (src/lib/bot-access.ts).
 */

// ─── Вход ──────────────────────────────────────────────────────────────────

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

/** Ошибку видит админ в чате, а не только в логах Vercel. */
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

  // Фото от админа — новое изображение товара.
  const photo = message.photo?.[message.photo.length - 1];
  if (photo) {
    await handlePhoto(chatId, photo.file_id);
    return;
  }

  const waiting = await takeBotSession(String(chatId));
  if (waiting && !text.startsWith("/")) {
    await handleFieldInput(chatId, waiting.kind, waiting.payload, text);
    return;
  }

  switch (command) {
    case "/start":
      await render(chatId, await menuScreen(await countsForBot()));
      return;
    case "/orders":
      await render(chatId, ordersScreen(await listOrdersByStatus("new"), "new"));
      return;
    case "/products":
      await render(chatId, productsScreen(await listProductsAdmin(), 0));
      return;
    default:
      await render(chatId, await menuScreen(await countsForBot()));
  }
}

async function handleFieldInput(chatId: number, kind: string, payload: string, text: string) {
  // kind="track", payload=<orderId> — владелец вводит трек-номер заявки
  if (kind === "track") {
    const order = await getOrderById(payload);
    if (!order) {
      await sendMessage(chatId, "Заявка не найдена — возможно, её удалили.");
      return;
    }
    const track = normalizeTrack(text);
    if (!track) {
      await sendMessage(chatId, "Нужен трек-номер из 4–40 символов: латиница, цифры, дефис. Например: RU123456789.");
      await setBotSession({ chatId: String(chatId), kind: "track", payload: order.id });
      return;
    }
    await setDeliveryStatus(order.id, isDeliveryStatus(order.deliveryStatus) ? order.deliveryStatus : "new", track);
    const updated = await getOrderById(order.id);
    if (!updated) {
      await sendMessage(chatId, "Заявка не найдена.");
      return;
    }
    await render(chatId, orderCardScreen(updated));
    return;
  }

  if (kind !== "edit") {
    await sendMessage(chatId, "Не понял, что изменить. Откройте карточку товара и нажмите нужное поле.");
    return;
  }
  // kind="edit", payload="<productId>:<field>"
  const [id, field] = payload.split(":");
  const product = await getProductById(id);
  if (!product) {
    await sendMessage(chatId, "Товар не найден — возможно, его удалили.");
    return;
  }

  if (field === "price") {
    const digits = Number(text.replace(/[^\d]/g, ""));
    if (!Number.isFinite(digits) || digits <= 0 || digits > 100_000_000) {
      await sendMessage(chatId, "Нужна цена в рублях, целое число больше нуля. Например: 89990.");
      return;
    }
    const updated = await updateProduct(id, { priceKopecks: Math.round(digits * 100) });
    if (!updated) return;
    await render(chatId, savedScreen(updated, `Цена обновлена: ${digits.toLocaleString("ru-RU")} ₽`));
    return;
  }

  if (field === "title") {
    const title = text.slice(0, 120).trim();
    if (title.length < 2) {
      await sendMessage(chatId, "Название слишком короткое — пришлите хотя бы 2 символа.");
      return;
    }
    const updated = await updateProduct(id, { title });
    if (!updated) return;
    await render(chatId, savedScreen(updated, "Название обновлено."));
    return;
  }

  if (field === "photo") {
    await sendMessage(chatId, "Жду фото одним сообщением (jpg, png или webp).");
    await setBotSession({ chatId: String(chatId), kind: "edit", payload: `${id}:photo` });
    return;
  }
}

async function handlePhoto(chatId: number, fileId: string) {
  const waiting = await takeBotSession(String(chatId));
  if (!waiting || waiting.kind !== "edit") {
    await sendMessage(
      chatId,
      "Фото получено, но не выбрано, куда его поставить. Откройте товар → «Фото».",
    );
    return;
  }
  const [id, field] = waiting.payload.split(":");
  if (field !== "photo") {
    await sendMessage(chatId, "Сейчас бот ждёт текст, а не фото.");
    return;
  }

  const product = await getProductById(id);
  if (!product) {
    await sendMessage(chatId, "Товар не найден.");
    return;
  }

  if (!storageDriver()) {
    await sendMessage(
      chatId,
      "Хранилище фото не настроено: задайте S3_BUCKET и S3_* в переменных окружения.",
    );
    return;
  }

  const fileUrl = await getFileUrl(fileId);
  if (!fileUrl) {
    await sendMessage(chatId, "Не удалось получить файл из Telegram. Попробуйте ещё раз.");
    return;
  }

  const res = await fetch(fileUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    await sendMessage(chatId, `Telegram не отдал файл (${res.status}).`);
    return;
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > 8 * 1024 * 1024) {
    await sendMessage(chatId, "Файл больше 8 МБ — сожмите и пришлите снова.");
    return;
  }

  const { saveImage } = await import("@/lib/storage");
  const stored = await saveImage({ body, contentType: "image/jpeg", ext: ".jpg" });
  const updated = await updateProduct(id, { photoUrl: stored.url });
  if (!updated) return;
  console.log(`[bot] фото товара ${id} → ${stored.url} (${stored.driver})`);
  await render(chatId, savedScreen(updated, "Фото обновлено."));
}

/**
 * Обновление сообщения о заявке в группе: подпись статуса и снятые кнопки.
 * Ошибки не валят обработку — заявка в БД уже в новом статусе.
 */
async function syncGroupStatus(
  order: Awaited<ReturnType<typeof getOrderById>>,
  status: OrderStatus,
  actor: string,
  /** Статус доставки — если сообщение обновили из-за него, а не из-за заявки. */
  delivery?: string,
): Promise<void> {
  if (!order?.groupMessageId || !process.env.GROUP_CHAT_ID) return;
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
    process.env.GROUP_CHAT_ID,
    Number(order.groupMessageId),
    delivery
      ? withDeliveryLine(base, deliveryLabel(delivery), actor)
      : withStatusLine(base, status, actor),
  );
}

// ─── Кнопки ────────────────────────────────────────────────────────────────

async function handleCallback(update: BotUpdate): Promise<void> {
  const query = update.callback_query!;
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const data = query.data ?? "";

  if (!isBotAdmin(query.from)) {
    await answerCallback(query.id, "Раздел доступен владельцу магазина");
    return;
  }
  if (!chatId || !messageId) {
    await answerCallback(query.id);
    return;
  }

  // Делим только по первому двоеточию: id заявок и товаров содержат дефисы,
  // а payload вида productId:field — ещё одно двоеточие.
  const at = data.indexOf(":");
  const action = at === -1 ? data : data.slice(0, at);
  const arg = at === -1 ? "" : data.slice(at + 1);

  switch (action) {
    case "menu":
      await answerCallback(query.id);
      await render(chatId, await menuScreen(await countsForBot()), messageId);
      return;

    case "orders": {
      await answerCallback(query.id);
      const filter = arg || "new";
      const orders = filter === "all" ? await listOrdersByStatus("new", 10) : await listOrdersByStatus(filter as OrderStatus, 10);
      await render(chatId, ordersScreen(orders, filter), messageId);
      return;
    }

    case "order": {
      await answerCallback(query.id);
      const order = await getOrderById(arg);
      if (!order) {
        await sendMessage(chatId, "Заявка не найдена.");
        return;
      }
      await render(chatId, orderCardScreen(order), messageId);
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
      await answerCallback(query.id, `Статус: ${order?.status ?? next}`);
      if (order) {
        await render(chatId, orderCardScreen(order), messageId);
        // То же сообщение в группе помечаем статусом — чтобы группа не висела «новой».
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
      await answerCallback(query.id, `Доставка: ${deliveryLabel(next)}`);
      if (order) {
        await render(chatId, orderCardScreen(order), messageId);
        await syncGroupStatus(order, (order.status as OrderStatus) ?? "new", query.from.first_name, next);
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
      await render(chatId, trackPromptScreen(order), messageId);
      await setBotSession({ chatId: String(chatId), kind: "track", payload: order.id });
      return;
    }

    case "products": {
      await answerCallback(query.id);
      await render(chatId, productsScreen(await listProductsAdmin(), Number(arg || 0)), messageId);
      return;
    }

    case "product": {
      await answerCallback(query.id);
      const product = await getProductById(arg);
      if (!product) {
        await sendMessage(chatId, "Товар не найден.");
        return;
      }
      await render(chatId, productCardScreen(product), messageId);
      return;
    }

    case "edit": {
      const [productId, field] = arg.split(":");
      const product = await getProductById(productId);
      await answerCallback(query.id);
      await render(chatId, fieldPrompt(field, product ?? undefined), messageId);
      await setBotSession({ chatId: String(chatId), kind: "edit", payload: `${productId}:${field}` });
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
      if (updated) await render(chatId, productCardScreen(updated), messageId);
      return;
    }

    default:
      await answerCallback(query.id);
      await clearBotSession(String(chatId));
      await render(chatId, await menuScreen(await countsForBot()), messageId);
  }
}
