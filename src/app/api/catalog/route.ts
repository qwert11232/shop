import { NextResponse } from "next/server";
import { listCatalog } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Публичный каталог: активные категории с активными товарами. */
export async function GET() {
  return NextResponse.json({ categories: listCatalog() });
}
