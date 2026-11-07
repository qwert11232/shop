"use client";

import { useEffect, useState } from "react";
import { apiHeaders, haptic } from "@/lib/telegram-webapp";
import { money } from "@/lib/format";
import ProductImage from "@/components/ui/ProductImage";

type Product = {
  id: string;
  title: string;
  price: number;
  photoUrl: string;
  brand: string;
};

/** Избранное: отметка хранится на сервере, поэтому переживает переустановку. */
export default function FavoritesScreen(props: {
  onOpen: (id: string) => void;
  onCart: () => void;
  notify: (text: string) => void;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetch("/api/favorites", { headers: apiHeaders() })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Не удалось загрузить избранное");
        return data;
      })
      .then((data) => setProducts(data.products ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось загрузить избранное"))
      .finally(() => setLoading(false));
  }, []);

  async function remove(id: string) {
    haptic("tap");
    setBusy(id);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ productId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось убрать");
      setProducts((list) => list.filter((p) => p.id !== id));
      props.notify("Убрано из избранного");
    } catch (e) {
      props.notify(e instanceof Error ? e.message : "Не удалось убрать");
    } finally {
      setBusy("");
    }
  }

  async function toCart(product: Product) {
    haptic("tap");
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ action: "add", productId: product.id, quantity: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось добавить");
      haptic("success");
      props.onCart();
      props.notify(`«${product.title}» в корзине`);
    } catch (e) {
      haptic("error");
      props.notify(e instanceof Error ? e.message : "Не удалось добавить");
    }
  }

  return (
    <div className="px-4 pb-6">
      <header className="app-header -mx-4 px-4 py-2.5">
        <span className="font-display font-bold text-[15px]">
          Избранное{products.length ? ` · ${products.length}` : ""}
        </span>
      </header>

      {loading && <p className="meta mt-4">Загружаем…</p>}

      {!loading && error && (
        <div className="mt-4 border border-signal rounded-[10px] px-3 py-2.5">
          <p className="text-[13px] font-semibold text-signal">Избранное недоступно</p>
          <p className="meta mt-1">{error}</p>
        </div>
      )}

      {!loading && !error && products.length === 0 && (
        <div className="empty mt-4">
          <div className="empty-icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0112 8.2a4.1 4.1 0 017.5 2.4C19.5 15.4 12 20 12 20z" />
            </svg>
          </div>
          <p className="t-section">Пока пусто</p>
          <p className="meta mt-1.5 max-w-[26ch] mx-auto">
            Сердечко в карточке товара сохранит его здесь — список не потеряется при закрытии
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-2 mt-3">
        {products.map((product) => (
          <li key={product.id} className="border border-rule rounded-[14px] p-2.5 flex gap-2.5">
            <button
              onClick={() => props.onOpen(product.id)}
              className="photo-frame h-[68px] w-[68px] shrink-0 rounded-[8px]"
              aria-label={`Открыть ${product.title}`}
            >
              <ProductImage src={product.photoUrl} alt={product.title} className="h-full w-full object-contain p-1" />
            </button>
            <div className="flex-1 min-w-0">
              {product.brand && <div className="t-brand">{product.brand}</div>}
              <button
                onClick={() => props.onOpen(product.id)}
                className="t-title line-clamp-2 text-left"
              >
                {product.title}
              </button>
              <div className="price t-price mt-1">{money(product.price)}</div>
            </div>
            <div className="flex flex-col gap-1 items-end justify-between">
              <button
                className="icon-btn text-ink-3"
                onClick={() => remove(product.id)}
                disabled={busy === product.id}
                aria-label={`Убрать ${product.title} из избранного`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
              <button className="btn-ghost !text-[12px] !py-1" onClick={() => toCart(product)}>
                В корзину
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
