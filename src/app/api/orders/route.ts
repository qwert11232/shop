import { NextRequest, NextResponse } from "next/server";
import { createOrder, getProduct } from "@/lib/repo";
import { buildOrderMessage, formatPrice, resolveUser, sendGroupMessage, userLabel } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Ограничения на заявки: от повторов, флуда и слишком частых сообщений в группу. */
const SAME_PRODUCT_WINDOW_MS = 60_000;
const MAX_ORDERS_PER_WINDOW = 5;
const RATE_WINDOW_MS = 60_000;
/** key (tg id или ip) → отметки времени отправленных заявок. Живёт в памяти процесса. */
const recentOrders = new Map<string, number[]>();
/** key (клиент + товар) → время последней заявки, чтобы двойной тап не давал две заявки. */
const recentByProduct = new Map<string, number>();

function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

function duplicateOrder(key: string, now: number): boolean {
  const last = recentByProduct.get(key);
  if (last !== undefined && now - last < SAME_PRODUCT_WINDOW_MS) return true;
  recentByProduct.set(key, now);
  if (recentByProduct.size > 5000) recentByProduct.clear();
  return false;
}

function rateLimited(key: string, now: number): boolean {
  const stamps = (recentOrders.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (stamps.length >= MAX_ORDERS_PER_WINDOW) {
    recentOrders.set(key, stamps);
    return true;
  }
  stamps.push(now);
  recentOrders.set(key, stamps);
  if (recentOrders.size > 5000) recentOrders.clear();
  return false;
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

  const product = getProduct(productId);
  if (!product || !product.isActive) {
    return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  }

  const user = resolveUser(
    req.headers.get("x-telegram-init-data") || body.initData || "",
    req.headers.get("host"),
  );
  const label = userLabel(user);
  const comment = (body.comment || "").slice(0, 500);

  const now = Date.now();
  const clientKey = user ? `tg:${user.id}` : `ip:${clientIp(req)}`;

  if (duplicateOrder(`${clientKey}|${product.id}`, now)) {
    return NextResponse.json(
      { error: "Заявка на этот товар уже отправлена. Подождите минуту." },
      { status: 429 },
    );
  }
  if (rateLimited(clientKey, now)) {
    return NextResponse.json({ error: "Слишком много заявок. Попробуйте через минуту." }, { status: 429 });
  }

  const message = buildOrderMessage({
    productTitle: product.title,
    priceKopecks: product.price,
    userLabel: label,
    comment,
    date: new Date(),
  });

  const groupMessageId = await sendGroupMessage(message);

  const order = createOrder({
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
