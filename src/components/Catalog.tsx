"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Product = {
  id: string;
  title: string;
  description: string;
  price: number; // копейки
  photoUrl: string;
  categoryId: string;
};
type Category = { id: string; name: string; icon: string; products: Product[] };

const fmt = (kopecks: number) => `${(kopecks / 100).toLocaleString("ru-RU")} ₽`;

function tgInitData(): string {
  return (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp
    ?.initData ?? "";
}

export default function Catalog() {
  const [cats, setCats] = useState<Category[]>([]);
  const [active, setActive] = useState<string>("all");
  const [selected, setSelected] = useState<Product | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ message: string; sentToGroup: boolean } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: { ready: () => void; expand: () => void } } })
      .Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => setCats(d.categories ?? []))
      .catch(() => setError("Не удалось загрузить каталог. Попробуйте позже."));
  }, []);

  const products = useMemo(() => {
    if (active === "all") return cats.flatMap((c) => c.products);
    return cats.find((c) => c.id === active)?.products ?? [];
  }, [cats, active]);

  async function submitOrder() {
    if (!selected || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-init-data": tgInitData(),
        },
        body: JSON.stringify({ initData: tgInitData(), productId: selected.id, comment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка оформления");
      setResult({ message: data.message, sentToGroup: data.sentToGroup });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка оформления");
    } finally {
      setSending(false);
    }
  }

  function closeModal() {
    setSelected(null);
    setResult(null);
    setComment("");
    setError("");
  }

  return (
    <main className="mx-auto max-w-md min-h-dvh flex flex-col px-4 pb-8">
      {/* шапка */}
      <header className="sticky top-0 z-30 -mx-4 px-4 py-3 flex items-center gap-3 bg-[#07090c]/85 backdrop-blur-md border-b border-line">
        <img src="/brand/logo.png" alt="ТЕХНОЛАБ" className="h-9 w-9 rounded-lg" />
        <div className="flex-1 leading-tight">
          <div className="font-display font-bold text-sm tracking-wide">ТЕХНОЛАБ</div>
          <div className="text-[11px] text-muted flex items-center gap-1.5">
            <span className="glow-dot" /> витрина техники · онлайн
          </div>
        </div>
        <Link href="/admin" className="btn-ghost !py-1.5 !px-3 text-xs" title="Панель владельца">
          ⚙️ Вход
        </Link>
      </header>

      {/* промо-полоса */}
      <section className="mt-4 rounded-2xl border border-line bg-gradient-to-r from-violet/25 via-surface to-acid/15 p-4">
        <div className="font-display font-bold text-lg leading-snug">
          Техника, которая <span className="text-acid">вдохновляет</span>
        </div>
        <p className="text-muted text-sm mt-1">
          Выберите позицию и нажмите «Оформить» — заявка сразу улетит в нашу группу 🚀
        </p>
      </section>

      {/* категории */}
      <nav className="no-scrollbar flex gap-2 overflow-x-auto mt-4 -mx-4 px-4 pb-1">
        <button className={`chip ${active === "all" ? "active" : ""}`} onClick={() => setActive("all")}>
          ✨ Все
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            className={`chip ${active === c.id ? "active" : ""}`}
            onClick={() => setActive(c.id)}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </nav>

      {/* сетка товаров */}
      {error && !selected && <p className="text-danger text-sm mt-4">{error}</p>}
      <section className="grid grid-cols-2 gap-3 mt-3 flex-1 content-start">
        {products.map((p) => (
          <button key={p.id} className="card text-left" onClick={() => setSelected(p)}>
            <div className="aspect-square bg-surface2">
              <img src={p.photoUrl} alt={p.title} className="h-full w-full object-cover" loading="lazy" />
            </div>
            <div className="p-2.5">
              <div className="text-[13px] font-bold leading-snug line-clamp-2 min-h-[2.1em]">{p.title}</div>
              <div className="price-tag text-sm mt-1">{fmt(p.price)}</div>
            </div>
          </button>
        ))}
        {products.length === 0 && !error && (
          <p className="col-span-2 text-center text-muted text-sm py-10">В этой категории пока пусто…</p>
        )}
      </section>

      <footer className="text-center text-[11px] text-muted mt-6">
        ТЕХНОЛАБ · заявки принимаются в группу Telegram 💬
      </footer>

      {/* модалка товара */}
      {selected && (
        <>
          <div className="sheet-backdrop" onClick={closeModal} />
          <div className="sheet">
            <div className="relative">
              <img src={selected.photoUrl} alt={selected.title} className="h-56 w-full object-cover" />
              <button
                onClick={closeModal}
                className="absolute top-3 right-3 h-9 w-9 rounded-full bg-black/60 text-white font-bold"
              >
                ✕
              </button>
              <div className="absolute bottom-3 left-4 price-tag text-xl">{fmt(selected.price)}</div>
            </div>
            <div className="p-4">
              <h2 className="font-display font-bold text-base leading-snug">{selected.title}</h2>
              {selected.description && (
                <p className="text-muted text-sm mt-2 leading-relaxed">{selected.description}</p>
              )}

              {!result ? (
                <div className="mt-4">
                  <label className="label">Комментарий к заявке (необязательно)</label>
                  <textarea
                    className="input min-h-[72px] resize-none"
                    placeholder="Например: хочу забрать завтра вечером…"
                    value={comment}
                    maxLength={500}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  {error && <p className="text-danger text-sm mt-2">{error}</p>}
                  <div className="mt-3">
                    <button className="btn-acid" onClick={submitOrder} disabled={sending}>
                      {sending ? "Отправляем…" : "🛒 Оформить заказ"}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted text-center mt-2">
                    Заявка придёт сообщением в группу ТЕХНОЛАБ
                  </p>
                </div>
              ) : (
                <div className="mt-4 text-center pop-in">
                  <div className="text-5xl">✅</div>
                  <h3 className="font-display font-bold mt-2">Заявка отправлена!</h3>
                  <p className="text-muted text-sm mt-1">
                    {result.sentToGroup
                      ? "Сообщение уже в группе — владелец скоро увидит."
                      : "Заявка сохранена (бот не настроен — см. .env)."}
                  </p>
                  <pre className="mt-3 whitespace-pre-wrap text-left text-xs bg-bg border border-line rounded-xl p-3 text-muted max-h-40 overflow-y-auto">
                    {result.message}
                  </pre>
                  <div className="mt-3">
                    <button className="btn-acid" onClick={closeModal}>
                      Отлично
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
