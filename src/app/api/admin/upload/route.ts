import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { isOwner, resolveUser } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_BYTES = 8 * 1024 * 1024;

/** Загрузка фото товара владельцем. POST multipart: file. */
export async function POST(req: NextRequest) {
  const user = resolveUser(req.headers.get("x-telegram-init-data") || "", req.headers.get("host"));
  if (!isOwner(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED.has(ext)) return NextResponse.json({ error: "Только jpg/png/webp" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 8 МБ" }, { status: 400 });

  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  console.log(`[admin] uploaded photo /uploads/${name} (${file.size} bytes)`);
  return NextResponse.json({ url: `/uploads/${name}` });
}
