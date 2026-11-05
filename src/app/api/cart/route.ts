import { NextRequest, NextResponse } from "next/server";
import { NO_AUTH, requestUser, userId } from "@/lib/api-user";
import { addToCart, getCart, removeFromCart, setCartQuantity } from "@/lib/shop";

export const dynamic = "force-dynamic";

/** GET — корзина пользователя. */
export async function GET(req: NextRequest) {
  const me = userId(requestUser(req));
  if (!me) return NextResponse.json(NO_AUTH, { status: 401 });
  return NextResponse.json({ cart: await getCart(me) });
}

/**
 * POST { initData?, action, productId, variantId?, quantity? }
 * action: add | set | remove
 * Количество ограничено 1..99, отсутствующий вариант проверяется на принадлежность товару.
 */
export async function POST(req: NextRequest) {
  let body: {
    initData?: string;
    action?: string;
    productId?: string;
    variantId?: string | null;
    quantity?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const me = userId(requestUser(req, body));
  if (!me) return NextResponse.json(NO_AUTH, { status: 401 });

  const productId = String(body.productId ?? "").trim();
  if (!productId) return NextResponse.json({ error: "Не выбран товар" }, { status: 400 });

  const quantity = Number(body.quantity ?? 1);
  if (!Number.isFinite(quantity)) return NextResponse.json({ error: "Некорректное количество" }, { status: 400 });

  try {
    switch (body.action ?? "add") {
      case "add":
        return NextResponse.json({ cart: await addToCart({ tgUserId: me, productId, variantId: body.variantId, quantity }) });
      case "set":
        return NextResponse.json({
          cart: await setCartQuantity({ tgUserId: me, productId, variantId: body.variantId, quantity: Math.round(quantity) }),
        });
      case "remove":
        return NextResponse.json({ cart: await removeFromCart({ tgUserId: me, productId, variantId: body.variantId }) });
      default:
        return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось изменить корзину";
    console.error("[cart]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
