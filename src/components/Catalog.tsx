"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconBox,
  IconCart,
  IconCheck,
  IconClose,
  IconGrid,
  IconMessage,
  IconTag,
  IconUser,
} from "./icons";

type Product = {
  id: string;
  title: string;
  description: string;
  price: number; // копейки
  photoUrl: string;
  categoryId: string;
};
type Category = { id: string; name: string; icon: string; products: Product[] };

const fmt = (kopecks: number) => `${(kopecks / 100).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: { ready: () => void; expand: () => void } } })
      .Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
    fetch("/api/catalog")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Сервер ответил ${r.status}`);
        return data;
      })
      .then((d) => setCats(d.categories ?? []))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Каталог не загрузился. Обновите страницу."),
      )
      .finally(() => setLoading(false));
  }, []);

  const products = useMemo(() => {
    if (active === "all") return cats.flatMap((c) => c.products);
    return cats.find((c) => c.id === active)?.products ?? [];
  }, [cats, active]);

  const activeName = active === "all" ? "Весь каталог" : cats.find((c) => c.id === active)?.name ?? "";

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
      if (!res.ok) throw new Error(data.error || "Не удалось отправить заявку");
      setResult({ message: data.message, sentToGroup: data.sentToGroup });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить заявку");
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
    <main className="mx-auto max-w-md min-h-dvh flex flex-col px-4 pb-10">
      {/* шапка: чёрная линия снизу, без размытия */}
      <header className="sticky top-0 z-30 -mx-4 px-4 py-3 flex items-center gap-3 bg-paper border-b border-ink">
        <span className="font-display font-bold text-[15px] tracking-tight">ТЕХНОЛАБ</span>
        <span className="meta">витрина техники</span>
        <span className="flex-1" />
        <Link href="/admin" className="btn-ghost" title="Панель владельца">
          <IconUser size={15} />
          Вход
        </Link>
      </header>

      {/* промо: чёрная плашка, один акцент — цена-сигнал */}
      <section className="mt-5 rounded-[14px] bg-ink text-white px-4 py-4">
        <p className="font-display font-bold text-[17px] leading-snug">
          Техника в наличии. Заявка — сразу в группу.
        </p>
        <p className="text-[13px] text-white/70 mt-1.5 leading-relaxed">
          Выберите позицию, оставьте комментарий — владелец увидит заявку в Telegram и свяжется.
        </p>
      </section>

      {/* категории: контурные чипы, выбранный — чёрный */}
      <nav className="no-scrollbar flex gap-2 overflow-x-auto mt-4 -mx-4 px-4 pb-1" aria-label="Категории">
        <button
          className={`chip ${active === "all" ? "active" : ""}`}
          onClick={() => setActive("all")}
          aria-pressed={active === "all"}
        >
          <IconGrid size={15} />
          Все
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            className={`chip ${active === c.id ? "active" : ""}`}
            onClick={() => setActive(c.id)}
            aria-pressed={active === c.id}
          >
            {c.name}
          </button>
        ))}
      </nav>

      {/* счётчик позиций вместо декоративной подписи */}
      <div className="flex items-baseline justify-between mt-4 mb-2">
        <h1 className="font-display font-bold text-[15px]">{activeName}</h1>
        {!error && (
          <span className="meta">
            {products.length} {products.length === 1 ? "позиция" : products.length < 5 ? "позиции" : "позиций"}
          </span>
        )}
      </div>

      {error && !selected && (
        <div className="border border-signal rounded-[10px] px-3 py-3 mb-3">
          <p className="text-[13px] font-semibold text-signal">Каталог не загрузился</p>
          <p className="text-[12px] text-ink-2 mt-1 leading-relaxed">{error}</p>
          <button
            className="btn-ghost mt-2.5"
            onClick={() => {
              setError("");
              setLoading(true);
              fetch("/api/catalog")
                .then((r) => r.json())
                .then((d) => setCats(d.categories ?? []))
                .catch(() => setError("Сервер недоступен. Попробуйте позже."))
                .finally(() => setLoading(false));
            }}
          >
            Повторить
          </button>
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-2 gap-3" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-[14px] border border-rule overflow-hidden">
              <div className="aspect-square bg-[#f4f4f4]" />
              <div className="p-2.5 space-y-2">
                <div className="h-3 bg-[#f0f0f0] rounded" />
                <div className="h-3 w-1/2 bg-[#f0f0f0] rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* сетка товаров: фото, название, цена */}
      {!loading && (
        <section className="grid grid-cols-2 gap-3 content-start flex-1">
          {products.map((p) => (
            <button key={p.id} className="card text-left" onClick={() => setSelected(p)}>
              <div className="aspect-square bg-[#f6f6f6]">
                <img
                  src={p.photoUrl}
                  alt={p.title}
                  className="h-full w-full object-contain p-2"
                  loading="lazy"
                />
              </div>
              <div className="p-2.5 border-t border-rule">
                <div className="text-[13px] font-semibold leading-snug line-clamp-2 min-h-[2.1em]">
                  {p.title}
                </div>
                <div className="price text-[14px] mt-1.5">{fmt(p.price)}</div>
              </div>
            </button>
          ))}
          {products.length === 0 && !error && (
            <div className="col-span-2 border border-rule rounded-[14px] py-12 text-center">
              <IconBox size={26} className="mx-auto text-ink-3" />
              <p className="text-[13px] text-ink-2 mt-2">В этой категории пока нет позиций</p>
            </div>
          )}
        </section>
      )}

      <footer className="mt-8 pt-4 border-t border-rule flex items-center gap-2">
        <IconMessage size={15} className="text-ink-2" />
        <span className="meta">Заявки принимаются в группу Telegram</span>
      </footer>

      {/* карточка товара */}
      {selected && (
        <>
          <div className="sheet-backdrop" onClick={closeModal} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label={selected.title}>
            <div className="relative border-b border-rule">
              <div className="aspect-[4/3] bg-[#f6f6f6]">
                <img src={selected.photoUrl} alt={selected.title} className="h-full w-full object-contain p-4" />
              </div>
              <button onClick={closeModal} className="icon-btn absolute top-2 right-2 bg-paper" aria-label="Закрыть">
                <IconClose size={18} />
              </button>
            </div>

            <div className="p-4">
              <h2 className="font-display font-bold text-[17px] leading-snug">{selected.title}</h2>
              <div className="price text-[22px] mt-1">{fmt(selected.price)}</div>
              {selected.description && (
                <p className="text-[13px] text-ink-2 mt-2.5 leading-relaxed">{selected.description}</p>
              )}

              {!result ? (
                <div className="mt-5">
                  <label className="label" htmlFor="order-comment">
                    Комментарий к заявке
                  </label>
                  <textarea
                    id="order-comment"
                    className="input min-h-[76px] resize-none"
                    placeholder="Например: заберу завтра вечером"
                    value={comment}
                    maxLength={500}
                    aria-invalid={Boolean(error)}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  {error && <p className="text-[12px] text-signal mt-1.5">{error}</p>}
                  <button className="btn-primary mt-3" onClick={submitOrder} disabled={sending}>
                    <IconCart size={17} />
                    {sending ? "Отправляем…" : "Оформить заказ"}
                  </button>
                  <p className="meta text-center mt-2">Заявка придёт в группу ТЕХНОЛАБ</p>
                </div>
              ) : (
                <div className="mt-5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-signal text-white">
                      <IconCheck size={15} />
                    </span>
                    <h3 className="font-display font-bold text-[15px]">Заявка отправлена</h3>
                  </div>
                  <p className="text-[13px] text-ink-2 mt-2">
                    {result.sentToGroup
                      ? "Сообщение уже в группе — владелец увидит его первым."
                      : "Заявка сохранена. Бот не настроен, поэтому сообщение в группу не ушло."}
                  </p>
                  <div className="mt-3 border border-rule rounded-[10px] p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <IconTag size={14} className="text-ink-2" />
                      <span className="meta">Текст заявки</span>
                    </div>
                    <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2 font-body">
                      {result.message}
                    </pre>
                  </div>
                  <button className="btn-primary mt-3" onClick={closeModal}>
                    Готово
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
