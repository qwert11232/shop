"use client";

import { useEffect, useMemo, useState } from "react";
import { apiHeaders, haptic } from "@/lib/telegram-webapp";
import { money, plural, shortDate } from "@/lib/format";

type Variant = { id: string; label: string; kind: string; extra: number };
type Spec = { group: string; name: string; value: string; unit: string; numeric: number | null };
type Media = { kind: "image" | "video"; url: string };
type Review = { id: string; author: string; rating: number; text: string; createdAt: number };
type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  photoUrl: string;
  brand: string;
  variants: Variant[];
  specs: Spec[];
  gallery: string[];
  media: Media[];
  rating: number | null;
  reviewCount: number;
  reviews: Review[];
  crossSell: { id: string; title: string; price: number; photoUrl: string }[];
};

type Tab = "description" | "specs" | "reviews";

const KIND_LABEL: Record<string, string> = {
  color: "Цвет",
  storage: "Память",
  config: "Комплектация",
  size: "Размер",
  variant: "Вариант",
};

export default function ProductScreen(props: {
  id: string;
  onBack: () => void;
  onCart: () => void;
  onOpen: (id: string) => void;
  notify: (text: string) => void;
  inCompare: boolean;
  onToggleCompare: (id: string) => void;
  cartCount: number;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [tab, setTab] = useState<Tab>("description");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [reviewForm, setReviewForm] = useState({ open: false, rating: 5, text: "" });

  useEffect(() => {
    setProduct(null);
    setGalleryIndex(0);
    setTab("description");
    fetch(`/api/catalog/${props.id}`, { headers: apiHeaders() })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Товар не найден");
        return data;
      })
      .then((data) => {
        setProduct(data.product);
        setFavorite(Boolean(data.favorite));
        // По умолчанию выбран первый вариант каждого типа.
        const first: Record<string, string> = {};
        for (const variant of data.product.variants as Variant[]) {
          if (!first[variant.kind]) first[variant.kind] = variant.id;
        }
        setSelected(first);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Товар не найден"));
  }, [props.id]);

  useEffect(() => {
    fetch(`/api/reviews?productId=${props.id}`, { headers: apiHeaders() })
      .then((r) => r.json())
      .then((d) => setCanReview(Boolean(d.canReview)))
      .catch(() => setCanReview(false));
  }, [props.id]);

  const grouped = useMemo(() => {
    const map = new Map<string, Variant[]>();
    for (const variant of product?.variants ?? []) {
      map.set(variant.kind, [...(map.get(variant.kind) ?? []), variant]);
    }
    return [...map.entries()];
  }, [product]);

  const chosenExtra = useMemo(
    () =>
      product
        ? Object.entries(selected).reduce((sum, [kind, id]) => {
            const variant = product.variants.find((v) => v.id === id && v.kind === kind);
            return sum + (variant?.extra ?? 0);
          }, 0)
        : 0,
    [product, selected],
  );

  const total = (product?.price ?? 0) + chosenExtra;

  const chosenVariantId = useMemo(() => {
    // В корзину уходит вариант того типа, где он меняет цену; цвета можно
    // не учитывать как отдельную позицию — применяем первый выбранный.
    if (!product) return null;
    const priceKind = grouped.find(([, variants]) => variants.some((v) => v.extra !== 0))?.[0];
    return priceKind ? selected[priceKind] ?? null : null;
  }, [product, grouped, selected]);

  const specGroups = useMemo(() => {
    const map = new Map<string, Spec[]>();
    for (const spec of product?.specs ?? []) {
      map.set(spec.group, [...(map.get(spec.group) ?? []), spec]);
    }
    return [...map.entries()];
  }, [product]);

  async function addToCart(quantity = 1) {
    if (!product || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ action: "add", productId: product.id, variantId: chosenVariantId, quantity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось добавить");
      haptic("success");
      props.notify("Добавлено в корзину");
      props.onCart();
    } catch (e) {
      haptic("error");
      props.notify(e instanceof Error ? e.message : "Не удалось добавить");
    } finally {
      setAdding(false);
    }
  }

  async function toggleFavorite() {
    if (!product) return;
    haptic("tap");
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ productId: product.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось");
      setFavorite(Boolean(data.favorite));
      props.notify(data.favorite ? "В избранном" : "Убрано из избранного");
    } catch (e) {
      props.notify(e instanceof Error ? e.message : "Не удалось");
    }
  }

  async function submitReview() {
    if (!product) return;
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ productId: product.id, rating: reviewForm.rating, text: reviewForm.text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось отправить отзыв");
      setProduct({ ...product, reviews: data.reviews, reviewCount: data.reviews.length });
      setCanReview(false);
      setReviewForm({ open: false, rating: 5, text: "" });
      haptic("success");
      props.notify("Спасибо за отзыв");
    } catch (e) {
      haptic("error");
      props.notify(e instanceof Error ? e.message : "Не удалось отправить отзыв");
    }
  }

  if (error) {
    return (
      <div className="px-4 py-10">
        <p className="text-[15px] font-semibold">{error}</p>
        <button className="btn-ghost mt-3" onClick={props.onBack}>Вернуться в каталог</button>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="px-4 py-4">
        <div className="aspect-square rounded-[14px] bg-[#f4f4f4]" />
        <div className="h-4 bg-[#f0f0f0] rounded mt-4 w-2/3" />
        <div className="h-4 bg-[#f0f0f0] rounded mt-2 w-1/3" />
      </div>
    );
  }

  // Галерея: изображения листаются снапом, видео вставляется отдельным кадром
  // с постером-картинкой — так же, как это делают маркетплейсы.
  const gallery: Media[] = product.media?.length
    ? product.media
    : (product.gallery.length ? product.gallery : [product.photoUrl]).map((url) => ({ kind: "image" as const, url }));

  return (
    <div className="flex flex-col pb-4">
      <header className="sticky top-0 z-20 bg-paper border-b border-ink px-4 py-2.5 flex items-center gap-2">
        <button className="icon-btn" onClick={props.onBack} aria-label="Назад">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="text-[13px] font-semibold truncate flex-1">{product.title}</span>
        <button
          className="icon-btn"
          onClick={toggleFavorite}
          aria-label={favorite ? "Убрать из избранного" : "В избранное"}
          aria-pressed={favorite}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden className={favorite ? "text-signal" : ""}>
            <path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0112 8.2a4.1 4.1 0 017.5 2.4C19.5 15.4 12 20 12 20z" />
          </svg>
        </button>
        <button
          className="icon-btn"
          onClick={() => props.onToggleCompare(product.id)}
          aria-label="Сравнить"
          aria-pressed={props.inCompare}
          style={{ color: props.inCompare ? "var(--color-signal)" : undefined }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <path d="M4 7h10M4 17h10M17 4v16M13 11l4 2-4 2" />
          </svg>
        </button>
      </header>

      {/* Галерея: свайп горизонтально, точки, счётчик */}
      <div className="relative bg-[#f6f6f6]">
        <div
          className="no-scrollbar flex overflow-x-auto snap-x snap-mandatory"
          onScroll={(e) => {
            const width = e.currentTarget.clientWidth;
            setGalleryIndex(Math.round(e.currentTarget.scrollLeft / width));
          }}
        >
          {gallery.map((item, index) =>
            item.kind === "video" ? (
              <div key={`${item.url}-${index}`} className="min-w-full snap-center aspect-square bg-ink">
                <video
                  src={item.url}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`${product.title} — видео`}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div key={`${item.url}-${index}`} className="min-w-full snap-center aspect-square flex items-center justify-center">
                <img src={item.url} alt={`${product.title} — фото ${index + 1}`} className="h-full w-full object-contain p-6" />
              </div>
            ),
          )}
        </div>
        {gallery.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {gallery.map((_, index) => (
              <span
                key={index}
                className={`h-1.5 rounded-full transition-all ${index === galleryIndex ? "w-4 bg-ink" : "w-1.5 bg-ink/25"}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-3">
        {product.brand && <div className="meta">{product.brand}</div>}
        <h1 className="font-display font-bold text-[18px] leading-snug mt-0.5">{product.title}</h1>
        <div className="flex items-baseline gap-2 mt-1.5">
          <span className="price text-[24px]">{money(total)}</span>
          {chosenExtra !== 0 && <span className="meta">базовая {money(product.price)}</span>}
        </div>
        {product.rating !== null && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Stars value={product.rating} />
            <span className="meta">
              {product.rating.toFixed(1)} · {product.reviewCount} {plural(product.reviewCount, "отзыв", "отзыва", "отзывов")}
            </span>
          </div>
        )}

        {/* Варианты: цвет, память, комплектация — цена меняется сразу */}
        {grouped.map(([kind, variants]) => (
          <fieldset key={kind} className="mt-4">
            <legend className="label">{KIND_LABEL[kind] ?? kind}</legend>
            <div className="flex flex-wrap gap-1.5">
              {variants.map((variant) => {
                const active = selected[kind] === variant.id;
                return (
                  <button
                    key={variant.id}
                    className={`chip ${active ? "active" : ""}`}
                    aria-pressed={active}
                    onClick={() => {
                      haptic("select");
                      setSelected((current) => ({ ...current, [kind]: variant.id }));
                    }}
                  >
                    {variant.label}
                    {variant.extra !== 0 && (
                      <span className="opacity-70">
                        {variant.extra > 0 ? "+" : "−"}
                        {money(Math.abs(variant.extra))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <button className="btn-primary" onClick={() => addToCart(1)} disabled={adding}>
            {adding ? "Добавляем…" : "В корзину"}
          </button>
          <button
            className="btn-ghost !px-3"
            onClick={() => props.onToggleCompare(product.id)}
            aria-pressed={props.inCompare}
          >
            {props.inCompare ? "В сравнении" : "Сравнить"}
          </button>
        </div>

        {/* Табы: не грузим один экран тремя простынями */}
        <div className="flex gap-1 mt-5 border-b border-rule" role="tablist">
          {(
            [
              ["description", "Описание"],
              ["specs", "Характеристики"],
              ["reviews", `Отзывы${product.reviewCount ? ` · ${product.reviewCount}` : ""}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                haptic("select");
                setTab(key);
              }}
              className={`px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
                tab === key ? "border-signal text-signal" : "border-transparent text-ink-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="py-3">
          {tab === "description" && (
            <p className="text-[13px] leading-relaxed text-ink-2">{product.description}</p>
          )}

          {tab === "specs" && (
            <div className="flex flex-col gap-3">
              {specGroups.map(([group, specs]) => (
                <div key={group}>
                  <div className="text-[12px] font-semibold mb-1">{group}</div>
                  <dl className="border border-rule rounded-[10px] overflow-hidden">
                    {specs.map((spec, index) => (
                      <div
                        key={spec.name}
                        className={`flex justify-between gap-3 px-3 py-2 text-[13px] ${index % 2 ? "bg-[#fafafa]" : ""}`}
                      >
                        <dt className="text-ink-2">{spec.name}</dt>
                        <dd className="font-medium text-right">
                          {spec.value}
                          {spec.unit ? ` ${spec.unit}` : ""}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}

          {tab === "reviews" && (
            <div>
              {canReview && !reviewForm.open && (
                <button className="btn-ghost mb-3" onClick={() => setReviewForm({ ...reviewForm, open: true })}>
                  Написать отзыв
                </button>
              )}
              {reviewForm.open && (
                <div className="border border-ink rounded-[14px] p-3 mb-3">
                  <div className="label">Оценка</div>
                  <div className="flex gap-1 mb-2">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        onClick={() => {
                          haptic("select");
                          setReviewForm({ ...reviewForm, rating: value });
                        }}
                        aria-label={`${value} из 5`}
                        aria-pressed={reviewForm.rating === value}
                        className={value <= reviewForm.rating ? "text-signal" : "text-ink-3"}
                      >
                        <StarIcon filled={value <= reviewForm.rating} />
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="input min-h-[72px] resize-none"
                    placeholder="Что понравилось, что нет"
                    value={reviewForm.text}
                    maxLength={1000}
                    onChange={(e) => setReviewForm({ ...reviewForm, text: e.target.value })}
                  />
                  <div className="flex gap-2 mt-2">
                    <button className="btn-primary" onClick={submitReview}>Отправить</button>
                    <button className="btn-ghost" onClick={() => setReviewForm({ open: false, rating: 5, text: "" })}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {product.reviews.length === 0 ? (
                <p className="text-[13px] text-ink-2">
                  Отзывов пока нет. Написать можно после получения заказа.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {product.reviews.map((review) => (
                    <li key={review.id} className="border-b border-rule pb-3 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold">{review.author}</span>
                        <Stars value={review.rating} />
                        <span className="meta ml-auto">{shortDate(review.createdAt)}</span>
                      </div>
                      {review.text && <p className="text-[13px] text-ink-2 mt-1 leading-relaxed">{review.text}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Cross-sell: аксессуары к этой технике */}
        {product.crossSell.length > 0 && (
          <section className="mt-2 mb-4">
            <h2 className="font-display font-bold text-[14px] mb-2">С этим товаром покупают</h2>
            <div className="no-scrollbar flex gap-2 overflow-x-auto -mx-4 px-4">
              {product.crossSell.map((item) => (
                <button
                  key={item.id}
                  onClick={() => props.onOpen(item.id)}
                  className="min-w-[132px] w-[132px] border border-rule rounded-[12px] text-left"
                >
                  <div className="aspect-square bg-[#f6f6f6] rounded-t-[12px]">
                    <img src={item.photoUrl} alt={item.title} className="h-full w-full object-contain p-2" loading="lazy" />
                  </div>
                  <div className="p-2">
                    <div className="text-[12px] font-medium line-clamp-2 min-h-[2.4em]">{item.title}</div>
                    <div className="price text-[12px] mt-1">{money(item.price)}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="flex gap-0.5 text-signal" aria-label={`Оценка ${value} из 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <StarIcon key={star} filled={star <= Math.round(value)} size={13} />
      ))}
    </span>
  );
}

function StarIcon({ filled, size = 18 }: { filled: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
      <path d="M12 3.6l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.9l6-.8z" />
    </svg>
  );
}
