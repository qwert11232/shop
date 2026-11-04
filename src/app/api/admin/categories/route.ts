import { NextRequest, NextResponse } from "next/server";
import { createCategory, listCategoriesAdmin } from "@/lib/repo";
import { isOwner, resolveUser } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function user(req: NextRequest) {
  return resolveUser(req.headers.get("x-telegram-init-data") || "");
}

/** Список всех категорий (включая скрытые) — только для владельца. */
export async function GET(req: NextRequest) {
  if (!isOwner(user(req))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ categories: listCategoriesAdmin() });
}

/** Создание категории. POST { name, icon? } — только для владельца. */
export async function POST(req: NextRequest) {
  if (!isOwner(user(req))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();
  const name = String(body.name || "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Укажите название категории" }, { status: 400 });
  const icon = String(body.icon || "📦").slice(0, 8);
  return NextResponse.json({ category: createCategory({ name, icon }) });
}
