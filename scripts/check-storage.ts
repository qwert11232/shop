/**
 * Проверка драйверов хранилища без сети и без облака.
 * Запуск: npm run check:storage
 */
import { existsSync, rmSync } from "fs";
import path from "path";
import { newObjectKey, publicUrlFor, saveImage, storageDriver } from "../src/lib/storage";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`[check:storage] FAIL — ${message}`);
    process.exit(1);
  }
  console.log(`[check:storage] ok — ${message}`);
}

async function main() {
  const envBackup = { ...process.env };
  delete process.env.S3_BUCKET;
  delete process.env.VERCEL;

  assert(storageDriver() === "local", "без S3 драйвер — local (локальная разработка)");

  const local = await saveImage({ body: Buffer.from("test"), contentType: "image/png", ext: ".png" });
  const localPath = path.join(process.cwd(), "public", local.url.replace(/^\//, ""));
  assert(local.driver === "local" && existsSync(localPath), "локальный драйвер пишет файл в public/uploads");
  rmSync(localPath, { force: true });

  process.env.VERCEL = "1";
  assert(storageDriver() === null, "на Vercel без S3 драйвера нет — не теряем файл молча");
  let threw = false;
  try {
    await saveImage({ body: Buffer.from("x"), contentType: "image/png", ext: ".png" });
  } catch {
    threw = true;
  }
  assert(threw, "без хранилища saveImage бросает StorageNotConfiguredError, а не пишет на read-only ФС");
  delete process.env.VERCEL;

  process.env.S3_BUCKET = "tekhnolab-media";
  process.env.S3_REGION = "auto";
  process.env.S3_ENDPOINT = "https://account.r2.cloudflarestorage.com";
  process.env.S3_PUBLIC_BASE_URL = "https://cdn.example.com/";
  assert(storageDriver() === "s3", "S3_BUCKET переключает драйвер на s3");

  const sent: Array<Record<string, unknown>> = [];
  const stub = {
    send: async (cmd: unknown) => {
      const c = cmd as { input: Record<string, unknown>; constructor: { name: string } };
      sent.push({ name: c.constructor.name, ...c.input });
      return {};
    },
  } as never;

  const stored = await saveImage(
    { body: Buffer.from("binary"), contentType: "image/webp", ext: ".webp" },
    { client: stub },
  );
  assert(stored.driver === "s3", "загрузка идёт в S3, а не на диск");
  assert(sent.length === 1 && sent[0].name === "PutObjectCommand", "отправляется PutObjectCommand");
  assert(sent[0].Bucket === "tekhnolab-media", "бакет берётся из S3_BUCKET");
  assert(sent[0].ContentType === "image/webp", "Content-Type соответствует расширению");
  assert(String(sent[0].Key).startsWith("products/"), "ключ объекта в префиксе products/");
  assert(stored.url.startsWith("https://cdn.example.com/products/"), "URL строится от S3_PUBLIC_BASE_URL");
  assert(!stored.url.includes("example.com//"), "двойной слэш в публичном URL не появляется");

  const urlNoBase = publicUrlFor(
    { bucket: "b", region: "eu-central-1", endpoint: undefined, publicBaseUrl: undefined },
    "products/a.jpg",
  );
  assert(urlNoBase === "https://b.s3.eu-central-1.amazonaws.com/products/a.jpg", "для AWS без S3_* URL строится по бакету и региону");

  const key = newObjectKey(".jpg");
  assert(/^products\/[a-z0-9]+-[a-z0-9]+\.jpg$/.test(key), "ключ объекта уникален и с нужным расширением");

  process.env = envBackup;
  console.log("[check:storage] PASS — драйверы хранилища работают как задумано");
}

main().catch((err) => {
  console.error("[check:storage] ошибка:", err);
  process.exit(1);
});
