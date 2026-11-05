import { NextRequest, NextResponse } from "next/server";
import { createOrder, getProduct, reserveOrderSlot } from "@/lib/repo";
import { buildOrderMessage, formatPrice, resolveUser, sendGroupMessage, userLabel } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Окно антифлуда: одна заявка на товар и не больше N заявок за период. */
const ORDER_WINDOW_MS = 60_000;
const MAX_ORDERS_PER_WINDOW = 5;

function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

/**
 * Создание заявки на товар.
 * POST { initData?, productId, comment? }
 * Заявка сохраняется в БД и (при настроенном боте) уходит сообщением в группу.
 */
export async function POST(req: NextRequest) {
  let body: { initData?: string; productId?: string; comment?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const productId = body.productId?.trim();
  if (!productId) return NextResponse.json({ error: "Не выбран товар" }, { status: 400 });

  const product = await getProduct(productId);
  if (!product || !product.isActive) {
    return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  }

  const user = resolveUser(
    req.headers.get("x-telegram-init-data") || body.initData || "",
    req.headers.get("host"),
  );
  const label = userLabel(user);
  const comment = (body.comment || "").slice(0, 500);

  const clientKey = user ? `tg:${user.id}` : `ip:${clientIp(req)}`;
  const gate = await reserveOrderSlot({
    clientKey,
    productId: product.id,
    now: Date.now(),
    windowMs: ORDER_WINDOW_MS,
    maxPerWindow: MAX_ORDERS_PER_WINDOW,
  });
  if (!gate.ok) {
    const message =
      gate.reason === "duplicate"
        ? "Заявка на этот товар уже отправлена. Подождите минуту."
        : "Слишком много заявок. Попробуйте через минуту.";
    return NextResponse.json({ error: message, retryInSec: gate.retryInSec }, { status: 429 });
  }

  const message = buildOrderMessage({
    productTitle: product.title,
    priceKopecks: product.price,
    userLabel: label,
    comment,
    date: new Date(),
  });

  const groupMessageId = await sendGroupMessage(message);

  const order = await createOrder({
    productId: product.id,
    comment,
    tgUserId: user ? String(user.id) : null,
    firstName: user ? [user.first_name, user.last_name].filter(Boolean).join(" ") || null : null,
    username: user?.username ?? null,
    groupMessageId,
  });

  console.log(`[orders] new order ${order.id} product=${product.title} by=${label} sentToGroup=${!!groupMessageId}`);

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    sentToGroup: !!groupMessageId,
    message,
    price: formatPrice(product.price),
  });
}
