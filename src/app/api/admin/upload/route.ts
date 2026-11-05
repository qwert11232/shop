import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { isOwner, resolveUser } from "@/lib/telegram";
import { saveImage, StorageNotConfiguredError, storageDriver } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ALLOWED = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const MAX_BYTES = 8 * 1024 * 1024;

/** Загрузка фото товара владельцем. POST multipart: file. */
export async function POST(req: NextRequest) {
  const user = resolveUser(req.headers.get("x-telegram-init-data") || "", req.headers.get("host"));
  if (!isOwner(user)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (!storageDriver()) {
    return NextResponse.json(
      { error: "Хранилище фото не настроено: задайте S3_BUCKET и S3_* в окружении" },
      { status: 501 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });

  const ext = path.extname(file.name).toLowerCase();
  const contentType = ALLOWED.get(ext);
  if (!contentType) return NextResponse.json({ error: "Только jpg/png/webp" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 8 МБ" }, { status: 400 });

  try {
    const stored = await saveImage(
      { body: Buffer.from(await file.arrayBuffer()), contentType, ext },
    );
    console.log(`[admin] uploaded photo ${stored.url} via ${stored.driver} (${file.size} bytes)`);
    return NextResponse.json({ url: stored.url, driver: stored.driver });
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 501 });
    }
    // Детали ошибки хранилища — в лог, клиенту только факт.
    console.error("[admin] upload failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Не удалось сохранить файл" }, { status: 502 });
  }
}
