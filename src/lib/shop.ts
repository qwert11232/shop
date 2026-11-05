import { getDb } from "./db";

/**
 * Покупка целиком: корзина, профиль, бонусы и заказы с доставкой.
 * Один модуль, потому что всё это завязано на tg_user_id и общую транзакцию
 * оформления — разносить по трём файлам значит дублировать проверки.
 */

// ─── Профиль ────────────────────────────────────────────────────────────────

export type Customer = {
  tgUserId: string;
  firstName: string;
  username: string;
  phone: string;
  bonusBalance: number;
  referralCode: string;
  referredBy: string | null;
};

type CustomerRow = {
  tg_user_id: string;
  first_name: string;
  username: string;
  phone: string;
  bonus_balance: number | string;
  referral_code: string;
  referred_by: string | null;
};

const toCustomer = (r: CustomerRow): Customer => ({
  tgUserId: r.tg_user_id,
  firstName: r.first_name,
  username: r.username,
  phone: r.phone,
  bonusBalance: Number(r.bonus_balance),
  referralCode: r.referral_code,
  referredBy: r.referred_by,
});

/** Код лояльности: короткий, читаемый, без похожих символов. */
function referralCodeFor(tgUserId: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let hash = 0;
  for (const char of tgUserId) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000_007;
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length) + 7;
  }
  return code;
}

/** Профиль создаётся при первом обращении: имя и username приходят из Telegram. */
export async function getOrCreateCustomer(input: {
  tgUserId: string;
  firstName?: string;
  username?: string;
}): Promise<Customer> {
  const db = await getDb();
  const existing = await db.get<CustomerRow>("SELECT * FROM customers WHERE tg_user_id = ?", [input.tgUserId]);
  if (existing) {
    if ((input.firstName && input.firstName !== existing.first_name) || (input.username && input.username !== existing.username)) {
      await db.run("UPDATE customers SET first_name = ?, username = ? WHERE tg_user_id = ?", [
        input.firstName || existing.first_name,
        input.username || existing.username,
        input.tgUserId,
      ]);
      return getOrCreateCustomer({ tgUserId: input.tgUserId });
    }
    return toCustomer(existing);
  }
  await db.run(
    `INSERT INTO customers (tg_user_id, first_name, username, phone, bonus_balance, referral_code, created_at)
     VALUES (?, ?, ?, '', 0, ?, ?)`,
    [
      input.tgUserId,
      input.firstName ?? "",
      input.username ?? "",
      referralCodeFor(input.tgUserId),
      Date.now(),
    ],
  );
  const created = await db.get<CustomerRow>("SELECT * FROM customers WHERE tg_user_id = ?", [input.tgUserId]);
  return toCustomer(created!);
}

export async function setCustomerPhone(tgUserId: string, phone: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE customers SET phone = ? WHERE tg_user_id = ?", [phone, tgUserId]);
}

// ─── Бонусы ─────────────────────────────────────────────────────────────────

export type BonusEvent = { id: string; amount: number; reason: string; createdAt: number };

export async function listBonusEvents(tgUserId: string, limit = 30): Promise<BonusEvent[]> {
  const db = await getDb();
  const rows = await db.all<{ id: string; amount: number | string; reason: string; created_at: number | string }>(
    "SELECT id, amount, reason, created_at FROM bonus_events WHERE tg_user_id = ? ORDER BY created_at DESC LIMIT ?",
    [tgUserId, limit],
  );
  return rows.map((r) => ({ id: r.id, amount: Number(r.amount), reason: r.reason, createdAt: Number(r.created_at) }));
}

function bonusId(): string {
  return `be-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function addBonus(tgUserId: string, amount: number, reason: string, orderId?: string): Promise<void> {
  const db = await getDb();
  await db.run(
    "INSERT INTO bonus_events (id, tg_user_id, amount, reason, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [bonusId(), tgUserId, amount, reason, orderId ?? null, Date.now()],
  );
  await db.run("UPDATE customers SET bonus_balance = bonus_balance + ? WHERE tg_user_id = ?", [amount, tgUserId]);
}

/**
 * Реферал: приглашённый получает 300 бонусов, пригласивший — 500.
 * Один раз на пользователя и никогда себе.
 */
export async function applyReferral(tgUserId: string, code: string): Promise<{ ok: boolean; reason?: string }> {
  const db = await getDb();
  const me = await db.get<CustomerRow>("SELECT * FROM customers WHERE tg_user_id = ?", [tgUserId]);
  if (!me) return { ok: false, reason: "Профиль не найден" };
  if (me.referred_by) return { ok: false, reason: "Реферальный код уже применён" };
  if (me.referral_code === code.trim().toUpperCase()) return { ok: false, reason: "Нельзя пригласить себя" };

  const inviter = await db.get<CustomerRow>("SELECT * FROM customers WHERE referral_code = ?", [
    code.trim().toUpperCase(),
  ]);
  if (!inviter) return { ok: false, reason: "Код не найден" };

  await db.run("UPDATE customers SET referred_by = ? WHERE tg_user_id = ?", [inviter.tg_user_id, tgUserId]);
  await addBonus(inviter.tg_user_id, 500, "Приглашён друг");
  await addBonus(tgUserId, 300, "Приветственный бонус по приглашению");
  return { ok: true };
}

/** Сколько бонусов можно списать: не больше 30% суммы и не больше баланса. */
export function maxBonusFor(total: number, balance: number): number {
  return Math.max(0, Math.min(balance, Math.floor(total * 0.3)));
}

// ─── Корзина ────────────────────────────────────────────────────────────────

export type CartLine = {
  productId: string;
  title: string;
  photoUrl: string;
  variantId: string | null;
  variantLabel: string;
  basePrice: number;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type Cart = { lines: CartLine[]; total: number; count: number };

type CartRow = {
  product_id: string;
  title: string;
  photo_url: string;
  variant_id: string | null;
  variant_label: string | null;
  base_price: number | string;
  variant_extra: number | string | null;
  quantity: number | string;
};

const emptyCart = (): Cart => ({ lines: [], total: 0, count: 0 });

export async function getCart(tgUserId: string): Promise<Cart> {
  const db = await getDb();
  const rows = await db.all<CartRow>(
    `SELECT c.product_id, p.title, p.photo_url, c.variant_id,
            v.label AS variant_label, p.price AS base_price, v.extra AS variant_extra, c.quantity
     FROM cart_items c
     JOIN products p ON p.id = c.product_id
     LEFT JOIN product_variants v ON v.id = c.variant_id
     WHERE c.tg_user_id = ?
     ORDER BY c.updated_at DESC`,
    [tgUserId],
  );

  const lines: CartLine[] = rows.map((r) => {
    const basePrice = Number(r.base_price);
    const unitPrice = basePrice + Number(r.variant_extra ?? 0);
    const quantity = Number(r.quantity);
    return {
      productId: r.product_id,
      title: r.title,
      photoUrl: r.photo_url,
      variantId: r.variant_id,
      variantLabel: r.variant_label ?? "",
      basePrice,
      unitPrice,
      quantity,
      lineTotal: unitPrice * quantity,
    };
  });

  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

export async function addToCart(input: {
  tgUserId: string;
  productId: string;
  variantId?: string | null;
  quantity?: number;
}): Promise<Cart> {
  const db = await getDb();
  const product = await db.get<{ id: string }>("SELECT id FROM products WHERE id = ?", [input.productId]);
  if (!product) throw new Error("Товар не найден");

  const variantId = input.variantId || null;
  if (variantId) {
    const variant = await db.get<{ id: string }>("SELECT id FROM product_variants WHERE id = ? AND product_id = ?", [
      variantId,
      input.productId,
    ]);
    if (!variant) throw new Error("Вариант товара не найден");
  }

  const quantity = Math.min(Math.max(input.quantity ?? 1, 1), 99);
  const existing = await db.get<{ quantity: number | string }>(
    `SELECT quantity FROM cart_items WHERE tg_user_id = ? AND product_id = ? AND ${variantId ? "variant_id = ?" : "variant_id IS NULL"}`,
    variantId ? [input.tgUserId, input.productId, variantId] : [input.tgUserId, input.productId],
  );

  if (existing) {
    await db.run(
      `UPDATE cart_items SET quantity = ?, updated_at = ? WHERE tg_user_id = ? AND product_id = ? AND ${variantId ? "variant_id = ?" : "variant_id IS NULL"}`,
      variantId
        ? [Math.min(Number(existing.quantity) + quantity, 99), Date.now(), input.tgUserId, input.productId, variantId]
        : [Math.min(Number(existing.quantity) + quantity, 99), Date.now(), input.tgUserId, input.productId],
    );
    return getCart(input.tgUserId);
  }

  await db.run(
    "INSERT INTO cart_items (tg_user_id, product_id, variant_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)",
    [input.tgUserId, input.productId, variantId, quantity, Date.now()],
  );
  return getCart(input.tgUserId);
}

export async function setCartQuantity(input: {
  tgUserId: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
}): Promise<Cart> {
  const db = await getDb();
  const variantId = input.variantId || null;
  const where = variantId
    ? "tg_user_id = ? AND product_id = ? AND variant_id = ?"
    : "tg_user_id = ? AND product_id = ? AND variant_id IS NULL";
  const params = variantId ? [input.tgUserId, input.productId, variantId] : [input.tgUserId, input.productId];

  if (input.quantity <= 0) {
    await db.run(`DELETE FROM cart_items WHERE ${where}`, params);
    return getCart(input.tgUserId);
  }
  await db.run(`UPDATE cart_items SET quantity = ?, updated_at = ? WHERE ${where}`, [
    Math.min(input.quantity, 99),
    Date.now(),
    ...params,
  ]);
  return getCart(input.tgUserId);
}

export async function removeFromCart(input: {
  tgUserId: string;
  productId: string;
  variantId?: string | null;
}): Promise<Cart> {
  return setCartQuantity({ ...input, quantity: 0 });
}

export async function clearCart(tgUserId: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM cart_items WHERE tg_user_id = ?", [tgUserId]);
}

// ─── Заказы ─────────────────────────────────────────────────────────────────

/**
 * Статусы доставки. Их меняет владелец в боте — клиент видит в личном кабинете.
 * `new` — заявка только создана, `packing` — собирается, `shipped` — передан
 * в доставку, `pickup` — ждёт в ПВЗ, `done` — получен, `cancelled` — отменён.
 */
export type DeliveryStatus = "new" | "packing" | "shipped" | "pickup" | "done" | "cancelled";

const DELIVERY_STATUSES: DeliveryStatus[] = ["new", "packing", "shipped", "pickup", "done", "cancelled"];

export function isDeliveryStatus(value: string): value is DeliveryStatus {
  return (DELIVERY_STATUSES as string[]).includes(value);
}

const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  new: "Собирается",
  packing: "Собирается",
  shipped: "Передан в доставку",
  pickup: "Ждёт в ПВЗ",
  done: "Получен",
  cancelled: "Отменён",
};

export function deliveryLabel(status: string): string {
  return isDeliveryStatus(status) ? DELIVERY_LABEL[status] : status;
}

/** Порядок шагов для прогресс-бара в карточке заказа. */
export const DELIVERY_STEPS: DeliveryStatus[] = ["packing", "shipped", "pickup", "done"];

export type OrderItem = {
  title: string;
  variant: string;
  price: number;
  quantity: number;
  productId: string;
};

export type OrderSummary = {
  id: string;
  createdAt: string;
  total: number;
  deliveryStatus: DeliveryStatus;
  trackNumber: string;
  /** Бонусы: сколько списали и сколько начислили — видно и в чеке, и в кабинете. */
  bonusUsed: number;
  bonusEarned: number;
  items: OrderItem[];
};

export async function listMyOrders(tgUserId: string): Promise<OrderSummary[]> {
  const db = await getDb();
  const rows = await db.all<{
    id: string;
    created_at: string;
    total: number | string;
    delivery_status: string;
    track_number: string;
    bonus_used: number | string | null;
    bonus_earned: number | string | null;
  }>(
    `SELECT id, created_at, total, delivery_status, track_number, bonus_used, bonus_earned FROM orders
     WHERE tg_user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [tgUserId],
  );

  const orders: OrderSummary[] = [];
  for (const row of rows) {
    const items = await db.all<{ title: string; variant: string; price: number | string; quantity: number | string; product_id: string }>(
      "SELECT title, variant, price, quantity, product_id FROM order_items WHERE order_id = ?",
      [row.id],
    );
    orders.push({
      id: row.id,
      createdAt: String(row.created_at),
      total: Number(row.total),
      deliveryStatus: isDeliveryStatus(row.delivery_status) ? row.delivery_status : "new",
      trackNumber: row.track_number,
      bonusUsed: Number(row.bonus_used ?? 0),
      bonusEarned: Number(row.bonus_earned ?? 0),
      items: items.map((i) => ({
        title: i.title,
        variant: i.variant,
        price: Number(i.price),
        quantity: Number(i.quantity),
        productId: i.product_id,
      })),
    });
  }
  return orders;
}

export type CreateOrderInput = {
  tgUserId: string;
  contactName: string;
  contactPhone: string;
  comment?: string;
  bonusToUse?: number;
  items: { productId: string; variantId?: string | null; quantity: number }[];
  groupMessageId?: string | null;
  total: number;
};

/**
 * Оформление заказа: позиции, сумма, списание и начисление бонусов.
 * Кешбэк 3% от оплаченной суммы начисляется сразу — это проще объяснить клиенту,
 * чем начисление после получения.
 */
export async function createPurchaseOrder(input: CreateOrderInput): Promise<OrderSummary> {
  const db = await getDb();
  const orderId = `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const bonusUsed = Math.max(0, Math.min(Math.round(input.bonusToUse ?? 0), input.total));
  const paid = input.total - bonusUsed;
  const bonusEarned = Math.round(paid * 0.03);

  await db.run(
    `INSERT INTO orders (id, status, comment, tg_user_id, first_name, username, group_message_id,
                         product_id, delivery_status, total, bonus_used, bonus_earned, contact_name, contact_phone)
     VALUES (?, 'new', ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`,
    [
      orderId,
      input.comment ?? "",
      input.tgUserId,
      input.contactName,
      "",
      input.groupMessageId ?? null,
      input.items[0]?.productId ?? "",
      input.total,
      bonusUsed,
      bonusEarned,
      input.contactName,
      input.contactPhone,
    ],
  );

  for (const item of input.items) {
    const product = await db.get<{ title: string; price: number | string }>(
      "SELECT title, price FROM products WHERE id = ?",
      [item.productId],
    );
    if (!product) continue;
    const variant = item.variantId
      ? await db.get<{ label: string; extra: number | string }>(
          "SELECT label, extra FROM product_variants WHERE id = ?",
          [item.variantId],
        )
      : null;
    const unitPrice = Number(product.price) + Number(variant?.extra ?? 0);
    await db.run(
      "INSERT INTO order_items (order_id, product_id, variant_id, title, variant, price, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        orderId,
        item.productId,
        item.variantId ?? null,
        product.title,
        variant?.label ?? "",
        unitPrice,
        item.quantity,
      ],
    );
  }

  await db.run("INSERT INTO order_events (id, order_id, status, actor, created_at) VALUES (?, ?, ?, ?, ?)", [
    `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    orderId,
    "new",
    "client",
    Date.now(),
  ]);

  if (bonusUsed > 0) await addBonus(input.tgUserId, -bonusUsed, "Оплата бонусами", orderId);
  if (bonusEarned > 0) await addBonus(input.tgUserId, bonusEarned, "Кешбэк за заказ", orderId);

  await clearCart(input.tgUserId);

  const summary = await listMyOrders(input.tgUserId);
  return summary.find((o) => o.id === orderId)!;
}

// ─── Статусы доставки (для админ-бота) ──────────────────────────────────────

export async function setDeliveryStatus(
  orderId: string,
  status: DeliveryStatus,
  trackNumber?: string,
): Promise<boolean> {
  const db = await getDb();
  const existing = await db.get<{ id: string }>("SELECT id FROM orders WHERE id = ?", [orderId]);
  if (!existing) return false;

  await db.run(
    "UPDATE orders SET delivery_status = ?, track_number = COALESCE(?, track_number) WHERE id = ?",
    [status, trackNumber ?? null, orderId],
  );
  await db.run("INSERT INTO order_events (id, order_id, status, actor, created_at) VALUES (?, ?, ?, ?, ?)", [
    `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    orderId,
    status,
    "admin",
    Date.now(),
  ]);
  return true;
}

export async function listOrdersByDelivery(limit = 10): Promise<
  { id: string; total: number; deliveryStatus: string; trackNumber: string; contactName: string; items: OrderItem[] }[]
> {
  const db = await getDb();
  const rows = await db.all<{
    id: string;
    total: number | string;
    delivery_status: string;
    track_number: string;
    contact_name: string;
  }>(
    `SELECT id, total, delivery_status, track_number, contact_name FROM orders
     WHERE delivery_status <> 'done' AND delivery_status <> 'cancelled'
     ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );

  const result = [];
  for (const row of rows) {
    const items = await db.all<{ title: string; variant: string; price: number | string; quantity: number | string; product_id: string }>(
      "SELECT title, variant, price, quantity, product_id FROM order_items WHERE order_id = ?",
      [row.id],
    );
    result.push({
      id: row.id,
      total: Number(row.total),
      deliveryStatus: row.delivery_status,
      trackNumber: row.track_number,
      contactName: row.contact_name,
      items: items.map((i) => ({
        title: i.title,
        variant: i.variant,
        price: Number(i.price),
        quantity: Number(i.quantity),
        productId: i.product_id,
      })),
    });
  }
  return result;
}

export { emptyCart, addBonus };
