"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  IconBox,
  IconChevronLeft,
  IconGrid,
  IconPlus,
  IconReceipt,
  IconUpload,
} from "./icons";

/** Формы ответов ниже повторяют src/lib/repo.ts — менять их нужно вместе. */
type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  photoUrl: string;
  isActive: boolean;
  categoryId: string;
  categoryName: string | null;
};
type Category = { id: string; name: string; icon: string; productCount: number };
type Order = {
  id: string;
  comment: string;
  status: string;
  firstName: string | null;
  username: string | null;
  createdAt: string;
  priceLabel: string;
  productTitle: string;
  productPhoto: string;
};

const fmt = (k: number) => `${(k / 100).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;

function headers() {
  const initData =
    (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? "";
  return { "x-telegram-init-data": initData, "Content-Type": "application/json" };
}

export default function AdminPanel() {
  const [tab, setTab] = useState<"products" | "categories" | "orders">("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [msg, setMsg] = useState("");

  // форма товара
  const [title, setTitle] = useState("");
  const [priceRub, setPriceRub] = useState("");
  const [desc, setDesc] = useState("");
  const [catId, setCatId] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  // форма категории
  const [catName, setCatName] = useState("");

  const load = useCallback(async () => {
    const [p, c, o] = await Promise.all([
      fetch("/api/admin/products", { headers: headers() }).then((r) => r.json()),
      fetch("/api/admin/categories", { headers: headers() }).then((r) => r.json()),
      fetch("/api/admin/orders", { headers: headers() }).then((r) => r.json()),
    ]);
    if (p.products) setProducts(p.products);
    if (c.categories) {
      setCategories(c.categories);
      if (!catId && c.categories.length) setCatId(c.categories[0].id);
    }
    if (o.orders) setOrders(o.orders);
  }, [catId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMsg("");
    try {
      const initData =
        (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? "";
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "x-telegram-init-data": initData },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка загрузки");
      setPhotoUrl(data.url);
      setMsg(`Фото загружено: ${data.url}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  async function addProduct() {
    setMsg("");
    const res = await fetch("/api/admin/products", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title, priceRub: Number(priceRub), description: desc, categoryId: catId, photoUrl }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error || "Ошибка");
    setMsg(`Товар добавлен: ${data.product.title}`);
    setTitle("");
    setPriceRub("");
    setDesc("");
    setPhotoUrl("");
    load();
  }

  async function addCategory() {
    setMsg("");
    const res = await fetch("/api/admin/categories", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: catName, icon: "" }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error || "Ошибка");
    setMsg(`Категория добавлена: ${data.category.name}`);
    setCatName("");
    load();
  }

  return (
    <main className="mx-auto max-w-md min-h-dvh px-4 pb-10">
      <header className="sticky top-0 z-30 -mx-4 px-4 py-3 flex items-center gap-2 bg-paper border-b border-ink">
        <span className="font-display font-bold text-[15px]">ТЕХНОЛАБ</span>
        <span className="meta">панель владельца</span>
        <span className="flex-1" />
        <Link href="/" className="btn-ghost">
          <IconChevronLeft size={15} />
          Витрина
        </Link>
      </header>

      <nav className="flex gap-2 mt-4" aria-label="Разделы панели">
        {(
          [
            ["products", "Товары", IconBox],
            ["categories", "Категории", IconGrid],
            ["orders", "Заявки", IconReceipt],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            className={`chip ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      {msg && (
        <p className="mt-3 text-[13px] rounded-[10px] border border-ink px-3 py-2">{msg}</p>
      )}

      {tab === "products" && (
        <section className="mt-4 flex flex-col gap-4">
          <div className="border border-ink rounded-[14px] p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <IconPlus size={16} />
              <h2 className="font-display font-bold text-[14px]">Новый товар</h2>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="label" htmlFor="p-title">Название</label>
                <input id="p-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="iPhone 16 Pro 256 ГБ" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="p-price">Цена, ₽</label>
                  <input id="p-price" className="input" type="number" min={1} inputMode="numeric" value={priceRub} onChange={(e) => setPriceRub(e.target.value)} placeholder="89990" />
                </div>
                <div>
                  <label className="label" htmlFor="p-cat">Категория</label>
                  <select id="p-cat" className="input" value={catId} onChange={(e) => setCatId(e.target.value)}>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="p-desc">Описание</label>
                <textarea id="p-desc" className="input min-h-[64px] resize-none" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Коротко о характеристиках" />
              </div>
              <div>
                <span className="label">Фото товара</span>
                <label
                  className={`flex items-center justify-center gap-2 border border-dashed border-ink rounded-[10px] py-3 cursor-pointer text-[13px] ${uploading ? "opacity-60" : ""}`}
                >
                  <IconUpload size={16} />
                  {uploading ? "Загружаем…" : photoUrl ? "Заменить фото" : "Выбрать файл"}
                  <input type="file" accept="image/*" onChange={onFile} className="sr-only" disabled={uploading} />
                </label>
                {photoUrl && (
                  <div className="flex items-center gap-2 mt-2">
                    <img src={photoUrl} alt="Превью товара" className="h-11 w-11 rounded-[8px] object-contain border border-rule bg-[#f6f6f6]" />
                    <span className="meta truncate">{photoUrl}</span>
                  </div>
                )}
              </div>
              <button className="btn-primary" onClick={addProduct} disabled={uploading}>
                Опубликовать товар
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {products.map((p) => (
              <div key={p.id} className="border border-rule rounded-[14px] p-3 flex items-center gap-3">
                <img src={p.photoUrl} alt="" className="h-11 w-11 rounded-[8px] object-contain bg-[#f6f6f6]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{p.title}</div>
                  <div className="meta truncate">
                    {p.categoryName ?? "Без категории"}
                  </div>
                </div>
                <span className="price text-[13px]">{fmt(p.price)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "categories" && (
        <section className="mt-4 flex flex-col gap-4">
          <div className="border border-ink rounded-[14px] p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <IconPlus size={16} />
              <h2 className="font-display font-bold text-[14px]">Новая категория</h2>
            </div>
            <label className="label" htmlFor="c-name">Название</label>
            <input id="c-name" className="input" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Например: Наушники" />
            <button className="btn-primary mt-3" onClick={addCategory}>
              Добавить категорию
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {categories.map((c) => (
              <div key={c.id} className="border border-rule rounded-[14px] p-3 flex items-center gap-3">
                <div className="flex-1 font-semibold text-[13px]">{c.name}</div>
                <span className="meta">товаров: {c.productCount}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "orders" && (
        <section className="mt-4 flex flex-col gap-2">
          {orders.length === 0 && (
            <div className="border border-rule rounded-[14px] py-12 text-center">
              <IconReceipt size={26} className="mx-auto text-ink-3" />
              <p className="text-[13px] text-ink-2 mt-2">Заявок пока нет</p>
            </div>
          )}
          {orders.map((o) => (
            <div key={o.id} className="border border-rule rounded-[14px] p-3 flex items-start gap-3">
              <img src={o.productPhoto} alt="" className="h-11 w-11 rounded-[8px] object-contain bg-[#f6f6f6]" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">{o.productTitle}</div>
                <div className="meta mt-0.5">
                  {o.priceLabel} — {o.firstName || "Гость"}
                  {o.username ? ` @${o.username}` : ""}
                </div>
                <div className="meta">{new Date(o.createdAt).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")}</div>
                {o.comment && (
                  <div className="text-[12px] mt-1.5 border-l-2 border-signal pl-2 text-ink-2">{o.comment}</div>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
