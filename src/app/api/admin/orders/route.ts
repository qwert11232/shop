import { NextRequest, NextResponse } from "next/server";
import { listOrdersAdmin } from "@/lib/repo";
import { formatPrice, isOwner, resolveUser } from "@/lib/telegram";

export const dynamic = "force-dynamic";

/** Список заявок — только для владельца. */
export async function GET(req: NextRequest) {
  const user = resolveUser(req.headers.get("x-telegram-init-data") || "", req.headers.get("host"));
  if (!isOwner(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const orders = listOrdersAdmin().map((o) => ({ ...o, priceLabel: formatPrice(o.productPrice) }));
  return NextResponse.json({ orders });
}
