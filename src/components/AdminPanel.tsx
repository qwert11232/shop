"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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

const fmt = (k: number) => `${(k / 100).toLocaleString("ru-RU")} ₽`;

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
  const [catIcon, setCatIcon] = useState("📦");

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
      body: JSON.stringify({ name: catName, icon: catIcon }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error || "Ошибка");
    setMsg(`Категория добавлена: ${data.category.icon} ${data.category.name}`);
    setCatName("");
    load();
  }

  return (
    <main className="mx-auto max-w-md min-h-dvh px-4 pb-10">
      <header className="sticky top-0 z-30 -mx-4 px-4 py-3 flex items-center gap-3 bg-[#07090c]/85 backdrop-blur-md border-b border-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.png" alt="ТЕХНОЛАБ" className="h-9 w-9 rounded-lg" />
        <div className="flex-1 leading-tight">
          <div className="font-display font-bold text-sm">ТЕХНОЛАБ · владелец</div>
          <div className="text-[11px] text-muted">управление витриной</div>
        </div>
        <Link href="/" className="btn-ghost !py-1.5 !px-3 text-xs">
          ← Витрина
        </Link>
      </header>

      <nav className="flex gap-2 mt-4">
        {(
          [
            ["products", "📦 Товары"],
            ["categories", "🗂 Категории"],
            ["orders", "🛒 Заявки"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`chip ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {msg && (
        <p className="mt-3 text-xs rounded-xl border border-acid/40 bg-acid/10 text-acid px-3 py-2">{msg}</p>
      )}

      {tab === "products" && (
        <section className="mt-4 flex flex-col gap-4">
          <div className="card p-4">
            <div className="font-display font-bold text-sm mb-3">＋ Новый товар</div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="label">Название</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="iPhone 16 Pro 256 ГБ" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Цена, ₽</label>
                  <input className="input" type="number" min={1} value={priceRub} onChange={(e) => setPriceRub(e.target.value)} placeholder="89990" />
                </div>
                <div>
                  <label className="label">Категория</label>
                  <select className="input" value={catId} onChange={(e) => setCatId(e.target.value)}>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Описание</label>
                <textarea className="input min-h-[64px] resize-none" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Коротко о характеристиках…" />
              </div>
              <div>
                <label className="label">Фото товара</label>
                <input type="file" accept="image/*" onChange={onFile} className="text-sm text-muted" disabled={uploading} />
                {photoUrl && (
                  <div className="flex items-center gap-2 mt-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoUrl} alt="превью" className="h-12 w-12 rounded-lg object-cover border border-line" />
                    <span className="text-xs text-muted truncate">{photoUrl}</span>
                  </div>
                )}
              </div>
              <button className="btn-acid" onClick={addProduct} disabled={uploading}>
                Опубликовать товар
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {products.map((p) => (
              <div key={p.id} className="card p-3 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.photoUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">{p.title}</div>
                  <div className="text-xs text-muted">
                    {p.categoryName ?? "Без категории"} · <span className="text-acid font-bold">{fmt(p.price)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "categories" && (
        <section className="mt-4 flex flex-col gap-4">
          <div className="card p-4">
            <div className="font-display font-bold text-sm mb-3">＋ Новая категория</div>
            <div className="flex gap-2">
              <input className="input !w-20 text-center" value={catIcon} onChange={(e) => setCatIcon(e.target.value)} maxLength={4} />
              <input className="input flex-1" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Например: Наушники" />
            </div>
            <button className="btn-acid mt-3" onClick={addCategory}>
              Добавить категорию
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {categories.map((c) => (
              <div key={c.id} className="card p-3 flex items-center gap-3">
                <span className="text-xl">{c.icon}</span>
                <div className="flex-1 font-bold text-sm">{c.name}</div>
                <span className="text-xs text-muted">товаров: {c.productCount}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "orders" && (
        <section className="mt-4 flex flex-col gap-2">
          {orders.length === 0 && <p className="text-muted text-sm text-center py-8">Заявок пока нет</p>}
          {orders.map((o) => (
            <div key={o.id} className="card p-3 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={o.productPhoto} alt="" className="h-12 w-12 rounded-lg object-cover" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{o.productTitle}</div>
                <div className="text-xs text-muted">
                  {o.priceLabel} · {o.firstName || "Гость"}
                  {o.username ? ` @${o.username}` : ""} · {new Date(o.createdAt).toLocaleString("ru-RU")}
                </div>
                {o.comment && <div className="text-xs mt-1 text-text/80">💬 {o.comment}</div>}
              </div>
              <span className="chip !py-1 !px-2 text-[10px]">{o.status}</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
