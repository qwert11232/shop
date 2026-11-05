import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { S3Client } from "@aws-sdk/client-s3";

/**
 * Хранилище фото товаров. Два драйвера:
 *   - `s3`    — объектное хранилище (R2/S3/MinIO), включается переменными `S3_*`;
 *   - `local` — запись в `public/uploads/`, только для локальной разработки.
 *
 * На Vercel файловая система доступна лишь на чтение и не переживает деплой,
 * поэтому без настроенного S3 загрузка честно отвечает ошибкой, а не теряет файл.
 */

export type StorageDriver = "s3" | "local";
export type StoredFile = { url: string; driver: StorageDriver };

export type UploadInput = { body: Buffer; contentType: string; ext: string };

/** Минимум от S3-клиента: подмена в проверках, без сети. */
export type S3Like = Pick<S3Client, "send">;

export class StorageNotConfiguredError extends Error {}

type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  publicBaseUrl?: string;
};

function s3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) return null;
  return {
    bucket,
    region: process.env.S3_REGION?.trim() || "auto",
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL?.trim() || undefined,
  };
}

export function storageDriver(): StorageDriver | null {
  if (s3Config()) return "s3";
  // На Vercel локальная запись невозможна — не притворяемся, что она работает.
  if (process.env.VERCEL) return null;
  return "local";
}

export function newObjectKey(ext: string): string {
  return `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
}

/** Публичный URL объекта: явная база, иначе путь от endpoint (R2/MinIO с публичным бакетом). */
export function publicUrlFor(cfg: S3Config, key: string): string {
  if (cfg.publicBaseUrl) return `${cfg.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  if (cfg.endpoint) return `${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}/${key}`;
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`;
}

let cachedClient: { client: S3Like; key: string } | null = null;

async function getS3Client(): Promise<S3Like> {
  const cfg = s3Config()!;
  const key = `${cfg.bucket}|${cfg.region}|${cfg.endpoint ?? ""}`;
  if (cachedClient?.key === key) return cachedClient.client;
  const { S3Client: RealS3Client } = await import("@aws-sdk/client-s3");
  const client = new RealS3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: Boolean(cfg.endpoint),
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  cachedClient = { client, key };
  return client;
}

export async function saveImage(
  input: UploadInput,
  deps: { client?: S3Like; driver?: StorageDriver | null } = {},
): Promise<StoredFile> {
  const driver = deps.driver ?? storageDriver();
  if (!driver) {
    throw new StorageNotConfiguredError(
      "Хранилище фото не настроено: задайте S3_BUCKET (и S3_*), на Vercel локальная запись недоступна",
    );
  }

  if (driver === "s3") {
    const cfg = s3Config()!;
    const client = deps.client ?? (await getS3Client());
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const objectKey = newObjectKey(input.ext);
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: objectKey,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return { url: publicUrlFor(cfg, objectKey), driver };
  }

  const name = newObjectKey(input.ext).replace(/^products\//, "");
  const dir = path.join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), input.body);
  return { url: `/uploads/${name}`, driver };
}
