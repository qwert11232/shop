import db from "./db";

/** Тонкий репозиторий поверх SQLite. Все суммы — в копейках (integer). */

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
  id: string; name: string; icon: string; sort_order: number; is_active: number; created_at: string;
};
type ProductRow = {
  id: string; title: string; description: string; price: number; photo_url: string;
  is_active: number; created_at: string; category_id: string;
};
type OrderRow = {
  id: string; status: string; comment: string; tg_user_id: string | null; first_name: string | null;
  username: string | null; group_message_id: string | null; created_at: string; product_id: string;
};

const cat = (r: CategoryRow): Category => ({
  id: r.id, name: r.name, icon: r.icon, sortOrder: r.sort_order, isActive: !!r.is_active, createdAt: r.created_at,
});
const prod = (r: ProductRow): Product => ({
  id: r.id, title: r.title, description: r.description, price: r.price, photoUrl: r.photo_url,
  isActive: !!r.is_active, createdAt: r.created_at, categoryId: r.category_id,
});
const ord = (r: OrderRow): Order => ({
  id: r.id, status: r.status, comment: r.comment, tgUserId: r.tg_user_id, firstName: r.first_name,
  username: r.username, groupMessageId: r.group_message_id, createdAt: r.created_at, productId: r.product_id,
});

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Публичный каталог: активные категории с активными товарами. */
export function listCatalog(): (Category & { products: Product[] })[] {
  const categories = db
    .prepare("SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, created_at ASC")
    .all() as CategoryRow[];
  const products = db
    .prepare("SELECT * FROM products WHERE is_active = 1 ORDER BY created_at DESC")
    .all() as ProductRow[];
  return categories.map((c) => ({
    ...cat(c),
    products: products.filter((p) => p.category_id === c.id).map(prod),
  }));
}

export function categoryExists(id: string): boolean {
  return !!db.prepare("SELECT id FROM categories WHERE id = ?").get(id);
}

export function getProduct(id: string): Product | null {
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id) as ProductRow | undefined;
  return row ? prod(row) : null;
}

export function createOrder(input: {
  productId: string; comment: string; tgUserId: string | null;
  firstName: string | null; username: string | null; groupMessageId: string | null;
}): Order {
  const id = uid();
  db.prepare(
    `INSERT INTO orders (id, comment, tg_user_id, first_name, username, group_message_id, product_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.comment, input.tgUserId, input.firstName, input.username, input.groupMessageId, input.productId);
  return ord(db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow);
}

export function listProductsAdmin(): (Product & { categoryName: string | null })[] {
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS categoryName FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.created_at DESC`
    )
    .all() as (ProductRow & { categoryName: string | null })[];
  return rows.map((r) => ({ ...prod(r), categoryName: r.categoryName }));
}

export function createProduct(input: {
  title: string; description: string; priceKopecks: number; photoUrl: string; categoryId: string;
}): Product {
  const id = uid();
  db.prepare(
    `INSERT INTO products (id, title, description, price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.title, input.description, input.priceKopecks, input.photoUrl, input.categoryId);
  return getProduct(id)!;
}

export function listCategoriesAdmin(): (Category & { productCount: number })[] {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS productCount
       FROM categories c ORDER BY c.sort_order ASC, c.created_at ASC`
    )
    .all() as (CategoryRow & { productCount: number })[];
  return rows.map((r) => ({ ...cat(r), productCount: r.productCount }));
}

export function createCategory(input: { name: string; icon: string }): Category {
  const id = uid();
  const max = db.prepare("SELECT MAX(sort_order) AS m FROM categories").get() as { m: number | null };
  db.prepare("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)").run(
    id, input.name, input.icon, (max.m ?? 0) + 1
  );
  return cat(db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as CategoryRow);
}

export function listOrdersAdmin(): (Order & { productTitle: string; productPrice: number; productPhoto: string })[] {
  const rows = db
    .prepare(
      `SELECT o.*, p.title AS productTitle, p.price AS productPrice, p.photo_url AS productPhoto
       FROM orders o JOIN products p ON p.id = o.product_id
       ORDER BY o.created_at DESC LIMIT 100`
    )
    .all() as (OrderRow & { productTitle: string; productPrice: number; productPhoto: string })[];
  return rows.map((r) => ({
    ...ord(r), productTitle: r.productTitle, productPrice: r.productPrice, productPhoto: r.productPhoto,
  }));
}
