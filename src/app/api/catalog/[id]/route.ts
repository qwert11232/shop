import { NextRequest, NextResponse } from "next/server";
import { getProductDetail } from "@/lib/catalog";
import { requestUser, userId } from "@/lib/api-user";
import { listFavoriteIds } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** Детальная карточка: варианты, характеристики, галерея, отзывы, cross-sell. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const detail = await getProductDetail(id);
  if (!detail) return NextResponse.json({ error: "Товар не найден" }, { status: 404 });

  const me = userId(requestUser(req));
  const favorite = me ? (await listFavoriteIds(me)).includes(id) : false;

  return NextResponse.json({ product: detail, favorite });
}
