import { NextRequest, NextResponse } from "next/server";
import { compareProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** GET /api/compare?ids=a,b,c — сравнение 2–3 моделей по общим характеристикам. */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const comparison = await compareProducts(ids);
  if (!comparison) {
    return NextResponse.json({ error: "Для сравнения нужно 2 или 3 товара" }, { status: 400 });
  }
  return NextResponse.json({ comparison });
}
