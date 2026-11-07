/**
 * Сжатие фото товаров при сборке.
 *
 * Зачем: PNG-скриншоты из маркетплейсов весят 200–750 КБ, хотя в плитке каталога
 * показываются шириной ~180 px. На мобильном интернете это и есть то самое
 * «фото долго грузятся»: страница ждёт мегабайты картинок.
 *
 * Скрипт обходит `public/products`, оставляет исходники (`originals/`) и пишет
 * сжатые версии на их место:
 *   - любой формат → WebP, ширина не больше 1000 px (галерея на телефоне шире не нужна);
 *   - качество 82: на фото товаров визуально не отличается, вес падает в 4–10 раз;
 *   - повторный прогон не портит уже сжатые файлы: результат пишется только если
 *     он легче исходника, а `originals/` служит источником истины.
 *
 * Запуск: `npm run optimize:images` (вручную) или `npm run build` (автоматически).
 * Если sharp недоступен, сборка не падает — печатается предупреждение.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";

// Две папки: студийные кадры каталога и живые фото с прилавка.
// Один скрипт на обе — иначе сборка сжимает половину галереи и забывает вторую.
const DIRS = ["products", "shop-photos"] as const;
const MAX_WIDTH = 1000;
const QUALITY = 82;

type Result = { name: string; before: number; after: number };

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  let sharp: typeof import("sharp").default;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.warn("[images] sharp недоступен — сжатие пропущено (npm i sharp)");
    return;
  }

  const results: Result[] = [];

  for (const dir of DIRS) {
  const folder = path.join(process.cwd(), "public", dir);
  const originals = path.join(folder, "originals");
  if (!(await exists(folder))) {
    console.log(`[images] нет public/${dir} — пропускаем`);
    continue;
  }

  await mkdir(originals, { recursive: true });
  // Только исходники PNG/JPEG: WebP уже сжат, повторный проход портил бы качество
  // и замедлял сборку. Добавили новое фото — положите PNG/JPEG, остальное сделает сборка.
  const files = (await readdir(folder)).filter((f) => /\.(png|jpe?g)$/i.test(f));
  if (files.length === 0) {
    console.log(`[images] public/${dir}: всё уже в WebP — сжатие не требуется`);
    continue;
  }

  for (const file of files) {
    const source = path.join(folder, file);
    const original = path.join(originals, file);
    // Исходник копируем один раз: дальше он всегда источник, даже если файл на месте уже сжатый.
    if (!(await exists(original))) {
      await writeFile(original, await readFile(source));
    }
    const cleanBuffer = await readFile(original);
    const meta = await sharp(cleanBuffer).metadata();
    const targetName = `${path.basename(file, path.extname(file))}.webp`;
    const target = path.join(folder, targetName);

    const compressed = await sharp(cleanBuffer)
      .resize({ width: Math.min(MAX_WIDTH, meta.width ?? MAX_WIDTH), withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 5 })
      .toBuffer();

    // Пишем всегда, если цели ещё нет: иначе крошечный исходник (6 КБ),
    // который в WebP весит столько же, остался бы без файла вовсе.
    const hasTarget = await exists(target);
    const currentSize = hasTarget ? (await stat(target)).size : compressed.length;
    if (!hasTarget || compressed.length < currentSize) {
      await writeFile(target, compressed);
    }
    results.push({
      name: targetName,
      before: cleanBuffer.length,
      after: hasTarget ? Math.min(compressed.length, currentSize) : compressed.length,
    });
  }
  }

  const totalBefore = results.reduce((sum, r) => sum + r.before, 0);
  const totalAfter = results.reduce((sum, r) => sum + r.after, 0);
  for (const r of results) {
    const ratio = ((1 - r.after / r.before) * 100).toFixed(0);
    console.log(`[images] ${r.name}: ${(r.before / 1024).toFixed(0)} → ${(r.after / 1024).toFixed(0)} КБ (−${ratio}%)`);
  }
  console.log(
    `[images] итого ${(totalBefore / 1024 / 1024).toFixed(2)} → ${(totalAfter / 1024 / 1024).toFixed(2)} МБ`,
  );
}

main().catch((err) => {
  // Сжатие не должно ронять сборку: без него сайт работает, просто медленнее.
  console.warn("[images] ошибка сжатия:", err instanceof Error ? err.message : err);
});
