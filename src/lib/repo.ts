import { getDb, type Db } from "./db";

/** Тонкий репозиторий поверх адаптера БД. Все суммы — в копейках (integer). */

export type Category = {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
};
export type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  photoUrl: string;
  isActive: boolean;
  createdAt: string;
  categoryId: string;
};
export type Order = {
  id: string;
  status: string;
  comment: string;
  tgUserId: string | null;
  firstName: string | null;
  username: string | null;
  groupMessageId: string | null;
  createdAt: string;
  productId: string;
  /** Статус доставки и трек — меняются владельцем в боте, видны клиенту в кабинете. */
  deliveryStatus: string;
  trackNumber: string;
  total: number;
};

type CategoryRow = {
  id: string; name: string; icon: string; sort_order: number; is_active: boolean | number; created_at: string;
};
type ProductRow = {
  id: string; title: string; description: string; price: number; photo_url: string;
  is_active: boolean | number; created_at: string; category_id: string;
};
type OrderRow = {
  id: string; status: string; comment: string; tg_user_id: string | null; first_name: string | null;
  username: string | null; group_message_id: string | null; created_at: string; product_id: string;
  delivery_status: string | null; track_number: string | null; total: number | string | null;
};

const cat = (r: CategoryRow): Category => ({
  id: r.id, name: r.name, icon: r.icon, sortOrder: Number(r.sort_order),
  isActive: Boolean(r.is_active), createdAt: String(r.created_at),
});
const prod = (r: ProductRow): Product => ({
  id: r.id, title: r.title, description: r.description, price: Number(r.price), photoUrl: r.photo_url,
  isActive: Boolean(r.is_active), createdAt: String(r.created_at), categoryId: r.category_id,
});
const ord = (r: OrderRow): Order => ({
  id: r.id, status: r.status, comment: r.comment, tgUserId: r.tg_user_id, firstName: r.first_name,
  username: r.username, groupMessageId: r.group_message_id, createdAt: String(r.created_at),
  productId: r.product_id,
  deliveryStatus: r.delivery_status ?? "new",
  trackNumber: r.track_number ?? "",
  total: Number(r.total ?? 0),
});

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** SQLite хранит флаг как 1/0, PostgreSQL — boolean; литерал зависит от диалекта. */
function trueLiteral(db: Db): string {
  return db.dialect === "postgres" ? "TRUE" : "1";
}

/** Публичный каталог: активные категории с активными товарами. */
export async function listCatalog(): Promise<(Category & { products: Product[] })[]> {
  const db = await getDb();
  const categories = await db.all<CategoryRow>(
    `SELECT * FROM categories WHERE is_active = ${trueLiteral(db)} ORDER BY sort_order ASC, created_at ASC`,
  );
  const products = await db.all<ProductRow>(
    `SELECT * FROM products WHERE is_active = ${trueLiteral(db)} ORDER BY created_at DESC`,
  );
  return categories.map((c) => ({
    ...cat(c),
    products: products.filter((p) => p.category_id === c.id).map(prod),
  }));
}

export async function categoryExists(id: string): Promise<boolean> {
  const db = await getDb();
  return !!(await db.get("SELECT id FROM categories WHERE id = ?", [id]));
}

export async function getProduct(id: string): Promise<Product | null> {
  const db = await getDb();
  const row = await db.get<ProductRow>("SELECT * FROM products WHERE id = ?", [id]);
  return row ? prod(row) : null;
}

export async function createOrder(input: {
  productId: string; comment: string; tgUserId: string | null;
  firstName: string | null; username: string | null; groupMessageId: string | null;
}): Promise<Order> {
  const db = await getDb();
  const id = uid();
  await db.run(
    `INSERT INTO orders (id, comment, tg_user_id, first_name, username, group_message_id, product_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.comment, input.tgUserId, input.firstName, input.username, input.groupMessageId, input.productId],
  );
  const row = await db.get<OrderRow>("SELECT * FROM orders WHERE id = ?", [id]);
  return ord(row!);
}

export async function listProductsAdmin(): Promise<(Product & { categoryName: string | null })[]> {
  const db = await getDb();
  const rows = await db.all<ProductRow & { categoryname: string | null }>(
    `SELECT p.*, c.name AS categoryname FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ORDER BY p.created_at DESC`,
  );
  return rows.map((r) => ({ ...prod(r), categoryName: r.categoryname }));
}

export async function createProduct(input: {
  title: string; description: string; priceKopecks: number; photoUrl: string; categoryId: string;
}): Promise<Product> {
  const db = await getDb();
  const id = uid();
  await db.run(
    "INSERT INTO products (id, title, description, price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.title, input.description, input.priceKopecks, input.photoUrl, input.categoryId],
  );
  return (await getProduct(id))!;
}

export async function listCategoriesAdmin(): Promise<(Category & { productCount: number })[]> {
  const db = await getDb();
  const rows = await db.all<CategoryRow & { productcount: number | string }>(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS productcount
     FROM categories c ORDER BY c.sort_order ASC, c.created_at ASC`,
  );
  return rows.map((r) => ({ ...cat(r), productCount: Number(r.productcount) }));
}

export async function createCategory(input: { name: string; icon: string }): Promise<Category> {
  const db = await getDb();
  const id = uid();
  const max = await db.get<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM categories");
  await db.run("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", [
    id, input.name, input.icon, Number(max?.m ?? 0) + 1,
  ]);
  const row = await db.get<CategoryRow>("SELECT * FROM categories WHERE id = ?", [id]);
  return cat(row!);
}

export async function listOrdersAdmin(): Promise<
  (Order & { productTitle: string; productPrice: number; productPhoto: string })[]
> {
  const db = await getDb();
  const rows = await db.all<
    OrderRow & { producttitle: string; productprice: number; productphoto: string }
  >(
    `SELECT o.*, p.title AS producttitle, p.price AS productprice, p.photo_url AS productphoto
     FROM orders o JOIN products p ON p.id = o.product_id
     ORDER BY o.created_at DESC LIMIT 100`,
  );
  return rows.map((r) => ({
    ...ord(r),
    productTitle: r.producttitle,
    productPrice: Number(r.productprice),
    productPhoto: r.productphoto,
  }));
}

/**
 * Антифлуд заявок на уровне БД: состояние общее для всех инстансов и переживает рестарт.
 * Схема — таблица `order_limits` (см. db.ts и db-setup.sql).
 */
export type OrderGate = { ok: true } | { ok: false; reason: "duplicate" | "rate"; retryInSec: number };

export async function reserveOrderSlot(input: {
  clientKey: string;
  productId: string;
  now: number;
  windowMs: number;
  maxPerWindow: number;
}): Promise<OrderGate> {
  const db = await getDb();
  await db.run("DELETE FROM order_limits WHERE created_at < ?", [input.now - input.windowMs]);

  const same = await db.get<{ created_at: number | string }>(
    `SELECT created_at FROM order_limits
     WHERE client_key = ? AND product_id = ?
     ORDER BY created_at DESC LIMIT 1`,
    [input.clientKey, input.productId],
  );
  if (same) {
    const last = Number(same.created_at);
    if (input.now - last < input.windowMs) {
      return { ok: false, reason: "duplicate", retryInSec: Math.ceil((input.windowMs - (input.now - last)) / 1000) };
    }
  }

  const count = await db.get<{ c: number | string }>(
    "SELECT COUNT(*) AS c FROM order_limits WHERE client_key = ? AND created_at >= ?",
    [input.clientKey, input.now - input.windowMs],
  );
  const used = Number(count?.c ?? 0);
  if (used >= input.maxPerWindow) {
    return { ok: false, reason: "rate", retryInSec: Math.ceil(input.windowMs / 1000) };
  }

  await db.run("INSERT INTO order_limits (client_key, product_id, created_at) VALUES (?, ?, ?)", [
    input.clientKey, input.productId, input.now,
  ]);
  return { ok: true };
}

// ─── Админ-бот ──────────────────────────────────────────────────────────────

export type OrderStatus = "new" | "contacted" | "done" | "cancelled";
const ORDER_STATUSES: OrderStatus[] = ["new", "contacted", "done", "cancelled"];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as string[]).includes(value);
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "новая",
  contacted: "на связи",
  done: "выполнена",
  cancelled: "отменена",
};

export function orderStatusLabel(status: string): string {
  return isOrderStatus(status) ? STATUS_LABEL[status] : status;
}

export type AdminOrder = Order & {
  productTitle: string;
  productPrice: number;
  productPhoto: string;
};

/** Заявки одного статуса для бота: новые сверху. */
/** Число позиций в заказе — витрина оформляет заказы из корзины. */
export async function countOrderItems(orderId: string): Promise<number> {
  const db = await getDb();
  const row = await db.get<{ c: number | string }>(
    "SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?",
    [orderId],
  );
  return Number(row?.c ?? 0);
}

export async function listOrdersByStatus(status: OrderStatus, limit = 10): Promise<AdminOrder[]> {
  const db = await getDb();
  const rows = await db.all<OrderRow & { producttitle: string; productprice: number; productphoto: string }>(
    `SELECT o.*, p.title AS producttitle, p.price AS productprice, p.photo_url AS productphoto
     FROM orders o JOIN products p ON p.id = o.product_id
     WHERE o.status = ?
     ORDER BY o.created_at DESC LIMIT ?`,
    [status, limit],
  );
  return rows.map((r) => ({
    ...ord(r),
    productTitle: r.producttitle,
    productPrice: Number(r.productprice),
    productPhoto: r.productphoto,
  }));
}

export async function getOrderById(id: string): Promise<AdminOrder | null> {
  const db = await getDb();
  const row = await db.get<OrderRow & { producttitle: string; productprice: number; productphoto: string }>(
    `SELECT o.*, p.title AS producttitle, p.price AS productprice, p.photo_url AS productphoto
     FROM orders o JOIN products p ON p.id = o.product_id WHERE o.id = ?`,
    [id],
  );
  return row
    ? {
        ...ord(row),
        productTitle: row.producttitle,
        productPrice: Number(row.productprice),
        productPhoto: row.productphoto,
      }
    : null;
}

/** message_id сообщения в группе: нужен, чтобы потом править его при смене статуса. */
export async function setGroupMessageId(id: string, messageId: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE orders SET group_message_id = ? WHERE id = ?", [messageId, id]);
}

export async function setOrderStatus(id: string, status: OrderStatus): Promise<boolean> {
  const db = await getDb();
  const existing = await db.get<{ id: string }>("SELECT id FROM orders WHERE id = ?", [id]);
  if (!existing) return false;
  await db.run("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
  return true;
}

export async function getProductById(id: string): Promise<Product | null> {
  return getProduct(id);
}

export async function updateProduct(
  id: string,
  patch: { title?: string; priceKopecks?: number; photoUrl?: string; isActive?: boolean },
): Promise<Product | null> {
  const db = await getDb();
  const current = await getProduct(id);
  if (!current) return null;
  const next = {
    title: patch.title ?? current.title,
    price: patch.priceKopecks ?? current.price,
    photoUrl: patch.photoUrl ?? current.photoUrl,
    isActive: patch.isActive ?? current.isActive,
  };
  await db.run("UPDATE products SET title = ?, price = ?, photo_url = ?, is_active = ? WHERE id = ?", [
    next.title,
    next.price,
    next.photoUrl,
    next.isActive,
    id,
  ]);
  return getProduct(id);
}

export async function countsForBot(): Promise<{
  newOrders: number;
  products: number;
  activeProducts: number;
  revenueDone: number;
}> {
  const db = await getDb();
  const newOrders = await db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM orders WHERE status = 'new'");
  const products = await db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM products");
  const active = await db.get<{ c: number | string }>(
    `SELECT COUNT(*) AS c FROM products WHERE is_active = ${trueLiteral(db)}`,
  );
  const revenue = await db.get<{ s: number | string | null }>(
    `SELECT COALESCE(SUM(p.price), 0) AS s FROM orders o JOIN products p ON p.id = o.product_id
     WHERE o.status = 'done'`,
  );
  return {
    newOrders: Number(newOrders?.c ?? 0),
    products: Number(products?.c ?? 0),
    activeProducts: Number(active?.c ?? 0),
    revenueDone: Number(revenue?.s ?? 0),
  };
}

// ─── Состояние диалога бота ─────────────────────────────────────────────────
// Хранится в БД, а не в памяти процесса: на Vercel инстансы сменяются,
// и «жду цену» из памяти пропадало бы при холодном старте.

export type BotSession = { chatId: string; kind: string; payload: string };

export async function setBotSession(session: BotSession): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  const existing = await db.get<{ chat_id: string }>("SELECT chat_id FROM bot_state WHERE chat_id = ?", [
    session.chatId,
  ]);
  if (existing) {
    await db.run("UPDATE bot_state SET kind = ?, payload = ?, updated_at = ? WHERE chat_id = ?", [
      session.kind,
      session.payload,
      now,
      session.chatId,
    ]);
  } else {
    await db.run("INSERT INTO bot_state (chat_id, kind, payload, updated_at) VALUES (?, ?, ?, ?)", [
      session.chatId,
      session.kind,
      session.payload,
      now,
    ]);
  }
}

/** Состояние старше 15 минут не считается: админ мог просто отвлечься. */
const BOT_SESSION_TTL_MS = 15 * 60_000;

export async function takeBotSession(chatId: string): Promise<BotSession | null> {
  const db = await getDb();
  const row = await db.get<{ chat_id: string; kind: string; payload: string; updated_at: number | string }>(
    "SELECT * FROM bot_state WHERE chat_id = ?",
    [chatId],
  );
  if (!row) return null;
  await db.run("DELETE FROM bot_state WHERE chat_id = ?", [chatId]);
  if (Date.now() - Number(row.updated_at) > BOT_SESSION_TTL_MS) return null;
  return { chatId: row.chat_id, kind: row.kind, payload: row.payload };
}

export async function clearBotSession(chatId: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM bot_state WHERE chat_id = ?", [chatId]);
}
