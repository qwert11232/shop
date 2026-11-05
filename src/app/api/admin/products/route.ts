import { NextRequest, NextResponse } from "next/server";
import { categoryExists, createProduct, listProductsAdmin } from "@/lib/repo";
import { isOwner, resolveUser } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function user(req: NextRequest) {
  return resolveUser(req.headers.get("x-telegram-init-data") || "", req.headers.get("host"));
}

/** Список всех товаров — только для владельца. */
export async function GET(req: NextRequest) {
  if (!isOwner(user(req))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ products: await listProductsAdmin() });
}

/**
 * Создание товара. POST { title, description?, priceRub, photoUrl, categoryId } — только для владельца.
 * Цена принимается в рублях и хранится в копейках (integer).
 */
export async function POST(req: NextRequest) {
  if (!isOwner(user(req))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const title = String(body.title || "").trim().slice(0, 120);
  const description = String(body.description || "").trim().slice(0, 2000);
  const photoUrl = String(body.photoUrl || "").trim().slice(0, 500);
  const categoryId = String(body.categoryId || "").trim();
  const priceRub = Number(body.priceRub ?? NaN);

  if (!title) return NextResponse.json({ error: "Укажите название товара" }, { status: 400 });
  if (!photoUrl) return NextResponse.json({ error: "Загрузите фото товара" }, { status: 400 });
  if (!Number.isFinite(priceRub) || priceRub <= 0 || priceRub > 100_000_000) {
    return NextResponse.json({ error: "Укажите корректную цену в рублях" }, { status: 400 });
  }
  if (!(await categoryExists(categoryId))) {
    return NextResponse.json({ error: "Категория не найдена" }, { status: 400 });
  }

  const product = await createProduct({
    title,
    description,
    priceKopecks: Math.round(priceRub * 100),
    photoUrl,
    categoryId,
  });
  console.log(`[admin] product created: ${product.id} ${product.title}`);
  return NextResponse.json({ product });
}
