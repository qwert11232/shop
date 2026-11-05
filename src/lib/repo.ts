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
