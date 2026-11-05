import { NextRequest, NextResponse } from "next/server";
import { NO_AUTH, requestUser, userId } from "@/lib/api-user";
import { buildOrderMessage, sendGroupMessage, userLabel } from "@/lib/telegram";
import { orderKeyboard } from "@/lib/order-message";
import {
  createPurchaseOrder,
  getCart,
  getOrCreateCustomer,
  maxBonusFor,
  setCustomerPhone,
  type CartLine,
} from "@/lib/shop";

export const dynamic = "force-dynamic";

/**
 * Оформление заказа из корзины в один запрос.
 *
 * POST { initData?, contactName?, phone?, comment?, useBonus?, bonusAmount? }
 * Имя и username подтягиваются из Telegram: клиент ничего не вводит повторно.
 * Сумма и цены пересчитываются на сервере — данные из браузера не принимаются на веру.
 */
export async function POST(req: NextRequest) {
  let body: {
    initData?: string;
    contactName?: string;
    phone?: string;
    comment?: string;
    useBonus?: boolean;
    bonusAmount?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const user = requestUser(req, body);
  const me = userId(user);
  if (!me || !user) return NextResponse.json(NO_AUTH, { status: 401 });

  const cart = await getCart(me);
  if (cart.lines.length === 0) {
    return NextResponse.json({ error: "Корзина пуста" }, { status: 400 });
  }

  const customer = await getOrCreateCustomer({
    tgUserId: me,
    firstName: user.first_name,
    username: user.username,
  });

  const phone = String(body.phone ?? customer.phone ?? "").replace(/[^\d+]/g, "");
  if (phone.replace(/\D/g, "").length < 10) {
    return NextResponse.json(
      { error: "Укажите телефон для доставки", needPhone: true },
      { status: 400 },
    );
  }
  if (phone !== customer.phone) await setCustomerPhone(me, phone);

  const contactName = String(body.contactName ?? customer.firstName ?? "").trim().slice(0, 60) || "Клиент";
  const comment = String(body.comment ?? "").slice(0, 500);

  const cap = maxBonusFor(cart.total, customer.bonusBalance);
  const bonusToUse = body.useBonus ? Math.min(Math.max(Math.round(Number(body.bonusAmount ?? cap)), 0), cap) : 0;

  const order = await createPurchaseOrder({
    tgUserId: me,
    contactName,
    contactPhone: phone,
    comment,
    bonusToUse,
    total: cart.total,
    items: cart.lines.map((line: CartLine) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
    })),
  });

  // Сообщение в группу: одна строка на позицию, чтобы владелец видел весь заказ.
  const itemsText = order.items
    .map((item) => `• ${item.title}${item.variant ? ` (${item.variant})` : ""} × ${item.quantity} — ${money(item.price * item.quantity)}`)
    .join("\n");
  const text = [
    buildOrderMessage({
      productTitle: `заказ из ${order.items.length} поз.`,
      priceKopecks: order.total,
      userLabel: userLabel(user),
      comment,
      date: new Date(),
    }),
    "",
    itemsText,
    bonusToUse > 0 ? `🎁 Списано бонусов: ${money(bonusToUse)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const messageId = await sendGroupMessage(text, order.id);
  if (messageId) {
    const { setGroupMessageId } = await import("@/lib/repo");
    await setGroupMessageId(order.id, messageId);
  }

  console.log(
    `[checkout] заказ ${order.id} на ${money(order.total)} (бонусы: ${bonusToUse}), позиций ${order.items.length}, telegram=${!!messageId}`,
  );

  return NextResponse.json({
    order: { ...order, groupMessageId: messageId },
    keyboard: orderKeyboard(order.id) ? true : false,
  });
}

function money(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;
}
