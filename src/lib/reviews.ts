import { getDb } from "./db";
import type { Review } from "./catalog";

/**
 * Отзывы. Правило: писать можно только о товаре, который клиент получил
 * (заказ в статусе done). Иначе отзывы превращаются в спам-площадку.
 * Один отзыв на товар от одного пользователя.
 */

export async function canReview(tgUserId: string, productId: string): Promise<boolean> {
  const db = await getDb();
  const bought = await db.get<{ id: string }>(
    `SELECT o.id FROM orders o
     JOIN order_items i ON i.order_id = o.id
     WHERE o.tg_user_id = ? AND i.product_id = ? AND o.delivery_status = 'done'
     LIMIT 1`,
    [tgUserId, productId],
  );
  if (!bought) return false;
  const existing = await db.get<{ id: string }>("SELECT id FROM reviews WHERE product_id = ? AND tg_user_id = ?", [
    productId,
    tgUserId,
  ]);
  return !existing;
}

export async function addReview(input: {
  tgUserId: string;
  productId: string;
  author: string;
  rating: number;
  text: string;
}): Promise<{ ok: true; review: Review } | { ok: false; reason: string }> {
  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) return { ok: false, reason: "Оценка — от 1 до 5" };
  const text = input.text.trim().slice(0, 1000);
  if (!(await canReview(input.tgUserId, input.productId))) {
    return { ok: false, reason: "Отзыв можно оставить после получения заказа" };
  }

  const db = await getDb();
  const id = `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = Date.now();
  await db.run(
    "INSERT INTO reviews (id, product_id, tg_user_id, author, rating, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, input.productId, input.tgUserId, input.author.slice(0, 60), rating, text, createdAt],
  );
  return { ok: true, review: { id, author: input.author, rating, text, createdAt } };
}

export async function listReviews(productId: string, limit = 20): Promise<Review[]> {
  const db = await getDb();
  const rows = await db.all<{ id: string; author: string; rating: number | string; text: string; created_at: number | string }>(
    "SELECT id, author, rating, text, created_at FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT ?",
    [productId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    author: r.author,
    rating: Number(r.rating),
    text: r.text,
    createdAt: Number(r.created_at),
  }));
}
