import { getDb } from "./db";
import {
  addProductMedia,
  addVariant,
  categoryIdByName,
  createProduct,
  deleteProduct,
  deleteSpec,
  deleteVariant,
  getProductById,
  listCategoriesAdmin,
  listSpecsForAdmin,
  listVariantsForAdmin,
  type Product,
  updateProduct,
  upsertSpec,
} from "./repo";
import {
  guessVariantKind,
  parseComment,
  parsePhone,
  parsePriceRub,
  parseSpecLines,
  parseVariantLine,
  type SpecLine,
} from "./bot-input";
import { grantBonus, setOrderComment } from "./shop";
import { draftMissing, type Draft } from "./bot-screens-admin";

/**
 * Действия панели, которые не зависят от Telegram.
 *
 * Вебхук занимается только разбором апдейта и отправкой сообщений; вся работа
 * с данными — здесь. Так один и тот же код можно прогнать проверкой без сети
 * (см. `scripts/check-bot.ts`): «пришёл текст — получилось вот такое состояние».
 */

export type StepResult = {
  ok: boolean;
  /** Готовый текст ответа; пусто — вызывающий покажет свой экран. */
  message?: string;
  /** Что делать дальше: параметры следующего шага или просто экран. */
  state?: { kind: string; payload: string };
};

// ─── Черновик нового товара ────────────────────────────────────────────────
// Живёт в bot_state как JSON: переживает холодный старт и не требует новой таблицы.

export function parseDraft(payload: string): Draft {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Draft) : {};
  } catch {
    return {};
  }
}

export function serializeDraft(draft: Draft): string {
  return JSON.stringify(draft);
}

export async function applyDraftField(
  draft: Draft,
  field: string,
  text: string,
): Promise<{ draft: Draft; error?: string }> {
  switch (field) {
    case "title": {
      const title = text.replace(/\s+/g, " ").trim().slice(0, 120);
      if (title.length < 2) return { draft, error: "Название слишком короткое — пришлите хотя бы 2 символа." };
      return { draft: { ...draft, title } };
    }
    case "price": {
      const price = parsePriceRub(text);
      if (price === null) {
        return { draft, error: "Нужна цена в рублях: целое число больше нуля, например <code>89 990</code>." };
      }
      return { draft: { ...draft, price } };
    }
    case "brand": {
      const brand = text.replace(/\s+/g, " ").trim().slice(0, 40);
      if (brand.length < 2) return { draft, error: "Бренд слишком короткий — или нажмите «Пропустить»." };
      return { draft: { ...draft, brand } };
    }
    case "desc": {
      const description = text.trim().slice(0, 900);
      if (description.length < 10) {
        return { draft, error: "Описание слишком короткое — минимум 10 символов, или нажмите «Пропустить»." };
      }
      return { draft: { ...draft, description } };
    }
    default:
      return { draft, error: "Не понял, что заполнить. Вернитесь к карточке черновика." };
  }
}

/**
 * Текст на шаге черновика без явно выбранного поля: заполняем первое пустое
 * обязательное. Так владелец может просто писать ответы подряд, как в чате,
 * не нажимая кнопку поля перед каждым сообщением.
 */
export async function applyDraftText(
  draft: Draft,
  text: string,
): Promise<{ draft: Draft; error?: string; needsCategory?: boolean }> {
  const missing = draftMissing(draft);
  const field = missing[0];
  if (!field) {
    return { draft, error: "Черновик уже заполнен — нажмите «Создать товар»." };
  }
  if (field === "categoryId") {
    return { draft, needsCategory: true, error: "Осталась категория — выберите её кнопкой ниже." };
  }
  return applyDraftField(draft, field, text);
}

export async function setDraftCategory(draft: Draft, categoryId: string): Promise<{ draft: Draft; error?: string }> {
  const categories = await listCategoriesAdmin();
  const found = categories.find((c) => c.id === categoryId);
  if (!found) return { draft, error: "Категория не найдена." };
  return { draft: { ...draft, categoryId: found.id, categoryName: found.name } };
}

/** Создание товара: проверяет обязательные поля ещё раз, до записи в базу. */
export async function createFromDraft(draft: Draft): Promise<{ ok: boolean; product?: Product; error?: string }> {
  if (!draft.title || !draft.price || !draft.categoryId) {
    return { ok: false, error: "Не хватает названия, цены или категории." };
  }
  const product = await createProduct({
    title: draft.title,
    priceKopecks: draft.price,
    categoryId: draft.categoryId,
    brand: draft.brand ?? "",
    description: draft.description ?? "",
    photoUrl: draft.photoUrl ?? "",
  });
  return { ok: true, product };
}

/** Категория по имени: если такой нет — создаём, чтобы владелец не упирался в отказ. */
export async function ensureCategory(name: string): Promise<{ id: string; name: string; created: boolean } | null> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 40);
  if (clean.length < 2) return null;
  const existing = await categoryIdByName(clean);
  if (existing) return { id: existing, name: clean, created: false };
  const db = await getDb();
  const id = `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const max = await db.get<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM categories");
  await db.run("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", [
    id,
    clean,
    "",
    Number(max?.m ?? 0) + 1,
  ]);
  return { id, name: clean, created: true };
}

// ─── Правка полей существующего товара ─────────────────────────────────────

export async function applyProductField(
  productId: string,
  field: string,
  text: string,
): Promise<{ ok: boolean; product?: Product; error?: string }> {
  const product = await getProductById(productId);
  if (!product) return { ok: false, error: "Товар не найден — возможно, его удалили." };

  switch (field) {
    case "price": {
      const price = parsePriceRub(text);
      if (price === null) return { ok: false, error: "Нужна цена в рублях: целое число больше нуля." };
      const updated = await updateProduct(productId, { priceKopecks: price });
      return updated ? { ok: true, product: updated } : { ok: false, error: "Не удалось сохранить цену." };
    }
    case "title": {
      const title = text.replace(/\s+/g, " ").trim().slice(0, 120);
      if (title.length < 2) return { ok: false, error: "Название слишком короткое." };
      const updated = await updateProduct(productId, { title });
      return updated ? { ok: true, product: updated } : { ok: false, error: "Не удалось сохранить название." };
    }
    case "brand": {
      const brand = text.replace(/\s+/g, " ").trim().slice(0, 40);
      const updated = await updateProduct(productId, { brand });
      return updated ? { ok: true, product: updated } : { ok: false, error: "Не удалось сохранить бренд." };
    }
    case "desc": {
      const description = text.trim().slice(0, 900);
      if (description.length < 10) return { ok: false, error: "Описание короче 10 символов — пришлите подробнее." };
      const updated = await updateProduct(productId, { description });
      return updated ? { ok: true, product: updated } : { ok: false, error: "Не удалось сохранить описание." };
    }
    default:
      return { ok: false, error: "Это поле нельзя изменить текстом." };
  }
}

export async function removeProduct(productId: string): Promise<boolean> {
  return deleteProduct(productId);
}

// ─── Варианты ──────────────────────────────────────────────────────────────

/**
 * Разбор пачки вариантов. Строки, которые не разобрались, возвращаются в
 * `skipped` и владелец видит их в ответе — молча глотать ввод нельзя.
 */
export async function addVariants(
  productId: string,
  raw: string,
): Promise<{ added: number; skipped: string[] }> {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
  let added = 0;
  const skipped: string[] = [];
  for (const line of lines) {
    const parsed = parseVariantLine(line);
    if (!parsed) {
      skipped.push(line.slice(0, 40));
      continue;
    }
    await addVariant({
      productId,
      label: parsed.label,
      kind: guessVariantKind(parsed.label),
      extraKopecks: Math.round(parsed.extraRub * 100),
    });
    added += 1;
  }
  return { added, skipped };
}

export async function removeVariant(productId: string, variantId: string): Promise<boolean> {
  return deleteVariant(productId, variantId);
}

// ─── Характеристики ────────────────────────────────────────────────────────

export async function addSpecs(
  productId: string,
  raw: string,
): Promise<{ added: number; skipped: string[]; specs: SpecLine[] }> {
  const { specs, skipped } = parseSpecLines(raw);
  for (const spec of specs.slice(0, 30)) {
    await upsertSpec({
      productId,
      group: spec.group,
      name: spec.name,
      value: spec.value,
      unit: spec.unit,
      numeric: spec.numeric,
    });
  }
  return { added: specs.length, skipped, specs };
}

export async function removeSpec(productId: string, name: string): Promise<boolean> {
  return deleteSpec(productId, name);
}

export async function specsOf(productId: string) {
  return listSpecsForAdmin(productId);
}

export async function variantsOf(productId: string) {
  return listVariantsForAdmin(productId);
}

// ─── Фото и галерея ────────────────────────────────────────────────────────

/**
 * Обложка: ставим ссылку на сохранённый файл. Первый кадр галереи тоже
 * обновляем, чтобы карточка не показывала старое фото вторым кадром.
 */
export async function setCover(productId: string, url: string): Promise<Product | null> {
  const updated = await updateProduct(productId, { photoUrl: url });
  if (!updated) return null;
  const db = await getDb();
  const first = await db.get<{ id: string }>(
    "SELECT id FROM product_media WHERE product_id = ? ORDER BY sort_order ASC LIMIT 1",
    [productId],
  );
  if (first) {
    await db.run("UPDATE product_media SET url = ? WHERE id = ?", [url, first.id]);
  } else {
    await addProductMedia({ productId, url, kind: "image" });
  }
  return updated;
}

export async function addGalleryImage(productId: string, url: string): Promise<void> {
  await addProductMedia({ productId, url, kind: "image" });
}

/** Видео в галерее — только ссылкой: файл целиком через вебхук не тянем. */
export async function addGalleryVideo(productId: string, url: string): Promise<{ ok: boolean; error?: string }> {
  const clean = url.trim();
  if (!/^https?:\/\/\S+\.(mp4|webm|mov)(\?\S*)?$/i.test(clean)) {
    return { ok: false, error: "Нужна прямая ссылка на видеофайл: mp4, webm или mov, начинается с http." };
  }
  await addProductMedia({ productId, url: clean, kind: "video" });
  return { ok: true };
}

// ─── Заказ: комментарий и телефон ──────────────────────────────────────────

export async function applyOrderComment(orderId: string, text: string): Promise<{ ok: boolean; comment?: string }> {
  const comment = parseComment(text, 300);
  if (comment.length < 2) return { ok: false };
  const ok = await setOrderComment(orderId, comment);
  return ok ? { ok: true, comment } : { ok: false };
}

export async function applyCustomerPhone(tgUserId: string, text: string): Promise<{ ok: boolean; phone?: string }> {
  const phone = parsePhone(text);
  if (!phone) return { ok: false };
  const db = await getDb();
  await db.run("UPDATE customers SET phone = ? WHERE tg_user_id = ?", [phone, tgUserId]);
  return { ok: true, phone };
}

// ─── Бонусы ────────────────────────────────────────────────────────────────

/**
 * «500» — начислить 500 ₽, «-200» — списать. Сумма вводится в рублях,
 * внутри хранится в копейках, как и весь остальной счёт магазина.
 */
export async function applyBonus(
  tgUserId: string,
  raw: string,
): Promise<{ ok: boolean; balance?: number; error?: string }> {
  const trimmed = raw.replace(/\s+/g, "");
  const negative = trimmed.startsWith("-") || trimmed.startsWith("−");
  const amount = parsePriceRub(trimmed.replace(/^[-−]/, ""));
  if (amount === null) return { ok: false, error: "Нужна сумма в рублях: например <code>500</code> или <code>-200</code>." };
  const result = await grantBonus({
    tgUserId,
    amount: negative ? -amount : amount,
    reason: negative ? "Списание владельцем" : "Начисление владельцем",
  });
  if (!result.ok) {
    return { ok: false, error: "Не удалось: профиль не найден или на балансе меньше, чем вы списываете." };
  }
  return { ok: true, balance: result.balance };
}

// ─── Массовые действия ─────────────────────────────────────────────────────

export type BulkResult = { affected: number; total: number };

/**
 * Скрыть или показать все товары категории.
 *
 * Возвращает и «сколько изменили», и «сколько всего в категории»: если владелец
 * скрыл категорию, где всё уже было скрыто, он должен увидеть «0 изменений»,
 * а не думать, что нажатие потерялось.
 */
export async function bulkSetActive(categoryId: string, active: boolean): Promise<BulkResult> {
  const db = await getDb();
  const total = await db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM products WHERE category_id = ?", [
    categoryId,
  ]);
  const changed = await db.get<{ c: number | string }>(
    `SELECT COUNT(*) AS c FROM products WHERE category_id = ? AND is_active = ${active ? "0" : "1"}`,
    [categoryId],
  );
  await db.run(
    `UPDATE products SET is_active = ${active ? "1" : "0"} WHERE category_id = ?`,
    [categoryId],
  );
  return { affected: Number(changed?.c ?? 0), total: Number(total?.c ?? 0) };
}

/**
 * Изменить цены всех товаров категории на процент.
 *
 * Процент считается от текущей цены и округляется до рубля: иначе после «+10%»
 * на витрине появляются цены вида 39 590,10 ₽ — в чеке и в чате такое читать
 * неприятно, а копейки всё равно ни на что не влияют. Минимальная цена — 1 ₽:
 * «-50%» на дешёвой позиции не должна сделать её бесплатной. Надбавки вариантов
 * (`extra`) процент не трогает — это отдельные цены.
 */
export async function bulkReprice(categoryId: string, percent: number): Promise<BulkResult> {
  const db = await getDb();
  const rows = await db.all<{ id: string; price: number | string }>(
    "SELECT id, price FROM products WHERE category_id = ?",
    [categoryId],
  );
  let affected = 0;
  for (const row of rows) {
    const price = Number(row.price);
    // Округление до рубля: (цена × (100 ± процент) / 100), затем до 100 копеек.
    const raw = Math.round((price * (100 + percent)) / 100);
    const next = Math.max(100, Math.round(raw / 100) * 100);
    if (next === price) continue;
    await db.run("UPDATE products SET price = ? WHERE id = ?", [next, row.id]);
    affected += 1;
  }
  return { affected, total: rows.length };
}

/** Сколько товаров категории сейчас на витрине и сколько скрыто. */
export async function categoryVisibility(categoryId: string): Promise<{ total: number; active: number; hidden: number }> {
  const db = await getDb();
  const total = await db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM products WHERE category_id = ?", [
    categoryId,
  ]);
  const active = await db.get<{ c: number | string }>(
    "SELECT COUNT(*) AS c FROM products WHERE category_id = ? AND is_active = 1",
    [categoryId],
  );
  const all = Number(total?.c ?? 0);
  const shown = Number(active?.c ?? 0);
  return { total: all, active: shown, hidden: all - shown };
}
