import { NextRequest, NextResponse } from "next/server";
import { NO_AUTH, requestUser, userId } from "@/lib/api-user";
import { listFavorites, toggleFavorite } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** GET — избранное пользователя. */
export async function GET(req: NextRequest) {
  const me = userId(requestUser(req));
  if (!me) return NextResponse.json(NO_AUTH, { status: 401 });
  return NextResponse.json({ products: await listFavorites(me) });
}

/** POST { productId, initData? } — добавить или убрать (переключатель). */
export async function POST(req: NextRequest) {
  let body: { initData?: string; productId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const me = userId(requestUser(req, body));
  if (!me) return NextResponse.json(NO_AUTH, { status: 401 });

  const productId = String(body.productId ?? "").trim();
  if (!productId) return NextResponse.json({ error: "Не выбран товар" }, { status: 400 });

  const favorite = await toggleFavorite(me, productId);
  return NextResponse.json({ favorite });
}
