"use client";

import { useEffect, useMemo, useState } from "react";
import { haptic } from "@/lib/telegram-webapp";
import { money } from "@/lib/format";
import ProductImage from "@/components/ui/ProductImage";
import PhotoCarousel from "@/components/ui/PhotoCarousel";
import { discountPercent, hasDiscount } from "@/lib/price";

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  /** Старая цена для витрины; 0 — скидки нет. */
  oldPrice?: number;
  photoUrl: string;
  /** Кадры галереи для карусели в сетке. */
  photos?: string[];
  categoryId: string;
  brand: string;
  createdAt?: string;
};
type Facet = { name: string; unit: string; values: { value: string; count: number }[] };
type Brand = { value: string; count: number };
type Category = { id: string; name: string; products: Product[] };

const SORTS: { key: string; label: string }[] = [
  { key: "popular", label: "По названию" },
  { key: "price-asc", label: "Сначала дешёвые" },
  { key: "price-desc", label: "Сначала дорогие" },
  { key: "new", label: "Новинки" },
];

export default function CatalogScreen(props: {
  onOpen: (id: string) => void;
  onCart: () => void;
  onCompare: () => void;
  compare: string[];
  onToggleCompare: (id: string) => void;
  cartCount: number;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);

  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("popular");
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedSpecs, setSelectedSpecs] = useState<Record<string, string[]>>({});
  const [priceRange, setPriceRange] = useState<{ min?: number; max?: number }>({});
  const [onlyDiscounted, setOnlyDiscounted] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Категории — один раз: они меняются только владельцем.
  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .catch(() => setError("Каталог не загрузился"));
  }, []);

  // Плоский список с фильтрами — на каждое изменение условия.
  useEffect(() => {
    const params = new URLSearchParams({ flat: "1", sort });
    if (category) params.set("category", category);
    if (search.trim()) params.set("search", search.trim());
    for (const brand of selectedBrands) params.append("brand", brand);
    for (const [name, values] of Object.entries(selectedSpecs)) {
      for (const value of values) params.append("spec", `${name}:${value}`);
    }
    if (priceRange.min) params.set("minPrice", String(priceRange.min / 100));
    if (priceRange.max) params.set("maxPrice", String(priceRange.max / 100));
    if (onlyDiscounted) params.set("sale", "1");

    let cancelled = false;
    setLoading(true);
    fetch(`/api/catalog?${params.toString()}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Ошибка каталога");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setProducts(data.products ?? []);
        setBrands(data.brands ?? []);
        setFacets(data.facets ?? []);
        setError("");
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Ошибка каталога"))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [category, search, sort, selectedBrands, selectedSpecs, priceRange, onlyDiscounted]);

  // Новинки: свежие по дате поступления. В ленте — шесть, дальше это уже
  // не «что нового», а второй каталог.
  const newest = useMemo(() => {
    const sorted = [...products].sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    return sorted.slice(0, 6);
  }, [products]);

  const activeFilters = useMemo(
    () =>
      selectedBrands.length +
      Object.values(selectedSpecs).reduce((sum, values) => sum + values.length, 0) +
      (priceRange.min || priceRange.max ? 1 : 0) +
      (onlyDiscounted ? 1 : 0),
    [selectedBrands, selectedSpecs, priceRange, onlyDiscounted],
  );

  function toggleBrand(value: string) {
    haptic("select");
    setSelectedBrands((current) =>
      current.includes(value) ? current.filter((b) => b !== value) : [...current, value],
    );
  }

  function toggleSpec(name: string, value: string) {
    haptic("select");
    setSelectedSpecs((current) => {
      const values = current[name] ?? [];
      const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
      return { ...current, [name]: next };
    });
  }

  function resetFilters() {
    setSelectedBrands([]);
    setSelectedSpecs({});
    setPriceRange({});
    setOnlyDiscounted(false);
  }

  return (
    <div className="flex flex-col">
      <header className="app-header">
        <div className="px-4 pt-3 pb-2 flex items-center gap-2.5">
          <span className="masthead">
            Техно<span className="signal">лаб</span>
          </span>
          <span className="h-3.5 w-px bg-rule" aria-hidden />
          <span className="t-brand !text-ink-3">каталог</span>
          <span className="flex-1" />
          {props.compare.length >= 2 && (
            <button onClick={props.onCompare} className="btn-ghost">
              Сравнить · {props.compare.length}
            </button>
          )}
          <a href="/admin" className="icon-btn" aria-label="Панель владельца" title="Панель владельца">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
            </svg>
          </a>
        </div>

        {/* Поиск: pl-11 оставляет место иконке. Раньше .input вне @layer
            перебивал pl-9, и текст начинался под лупой. */}
        <div className="px-4 pb-2.5">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none"
              width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input
              className="input pl-11"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Найти технику или бренд"
              inputMode="search"
              aria-label="Поиск по каталогу"
            />
            {search && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 icon-btn"
                onClick={() => setSearch("")}
                aria-label="Очистить поиск"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="px-4">
        {/* Категории: лента с затуханием по краю — видно, что есть ещё */}
        <nav className="no-scrollbar edge-fade flex gap-4 overflow-x-auto -mx-4 px-4 pt-1" aria-label="Категории">
          <button
            className={`tab ${category === "" ? "active" : ""}`}
            onClick={() => {
              haptic("select");
              setCategory("");
            }}
            aria-pressed={category === ""}
          >
            Всё
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`tab ${category === c.id ? "active" : ""}`}
              onClick={() => {
                haptic("select");
                setCategory(c.id);
                resetFilters();
              }}
              aria-pressed={category === c.id}
            >
              {c.name}
            </button>
          ))}
        </nav>

        {/* Строка управления: счётчик слева, сортировка и фильтры справа.
            Раньше здесь был выпадающий список — на iOS он выглядит как поле ввода
            и спорит с поиском. Теперь сортировка — текстовая кнопка. */}
        <div className="flex items-center gap-2 mt-3 pb-2 border-b border-rule">
          <span className="t-brand !text-ink-2">{loading ? "ищем…" : `${products.length} позиций`}</span>
          <span className="flex-1" />
          <button
            className="text-[12px] font-semibold text-ink-2 inline-flex items-center gap-1"
            onClick={() => {
              haptic("tap");
              setSortOpen((open) => !open);
            }}
            aria-expanded={sortOpen}
            aria-label="Сортировка"
          >
            {SORTS.find((s) => s.key === sort)?.label ?? "Сортировка"}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <span className="h-3 w-px bg-rule" aria-hidden />
          <button
            className={`text-[12px] font-semibold inline-flex items-center gap-1 ${activeFilters ? "text-signal" : "text-ink-2"}`}
            onClick={() => {
              haptic("tap");
              setFiltersOpen((open) => !open);
            }}
            aria-expanded={filtersOpen}
          >
            Фильтры{activeFilters ? ` · ${activeFilters}` : ""}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M7 12h10M10 17h4" />
            </svg>
          </button>
        </div>

        {sortOpen && (
          <div className="border border-rule rounded-[10px] mt-2 overflow-hidden">
            {SORTS.map((option) => (
              <button
                key={option.key}
                className={`w-full text-left px-3 py-2.5 text-[13px] border-b border-rule last:border-b-0 flex items-center gap-2 ${
                  sort === option.key ? "font-semibold" : "text-ink-2"
                }`}
                onClick={() => {
                  haptic("select");
                  setSort(option.key);
                  setSortOpen(false);
                }}
                aria-pressed={sort === option.key}
              >
                {option.label}
                {sort === option.key && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="ml-auto text-signal" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}

        {filtersOpen && (
          <div className="mt-3 border border-ink rounded-[14px] p-3">
            {/* Скидка — первым чипом: это самый частый повод зайти в каталог */}
            <fieldset className="mb-3">
              <legend className="label">Выгода</legend>
              <div className="flex flex-wrap gap-1.5">
                <button
                  className={`chip !py-1 !px-2.5 text-[12px] ${onlyDiscounted ? "active" : ""}`}
                  onClick={() => {
                    haptic("select");
                    setOnlyDiscounted((on) => !on);
                  }}
                  aria-pressed={onlyDiscounted}
                >
                  Со скидкой
                </button>
              </div>
            </fieldset>

            {priceRange.min || priceRange.max || activeFilters > 0 ? (
              <button className="btn-ghost mb-3" onClick={resetFilters}>
                Сбросить всё
              </button>
            ) : null}

            {brands.length > 0 && (
              <fieldset className="mb-3">
                <legend className="label">Бренд</legend>
                <div className="flex flex-wrap gap-1.5">
                  {brands.map((b) => (
                    <button
                      key={b.value}
                      className={`chip !py-1 !px-2.5 text-[12px] ${selectedBrands.includes(b.value) ? "active" : ""}`}
                      onClick={() => toggleBrand(b.value)}
                      aria-pressed={selectedBrands.includes(b.value)}
                    >
                      {b.value} <span className="opacity-60">{b.count}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Цена: быстрые диапазоны вместо двух полей с клавиатурой */}
            <fieldset className="mb-3">
              <legend className="label">Цена</legend>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "до 10 000 ₽", min: undefined, max: 1000000 },
                  { label: "10–50 тыс.", min: 1000000, max: 5000000 },
                  { label: "50–100 тыс.", min: 5000000, max: 10000000 },
                  { label: "от 100 тыс.", min: 10000000, max: undefined },
                ].map((range) => (
                  <button
                    key={range.label}
                    className={`chip !py-1 !px-2.5 text-[12px] ${
                      priceRange.min === range.min && priceRange.max === range.max ? "active" : ""
                    }`}
                    onClick={() => {
                      haptic("select");
                      setPriceRange({ min: range.min, max: range.max });
                    }}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {facets.map((facet) => (
              <fieldset key={facet.name} className="mb-3 last:mb-0">
                <legend className="label">
                  {facet.name}
                  {facet.unit ? `, ${facet.unit}` : ""}
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {facet.values.map((value) => {
                    const active = (selectedSpecs[facet.name] ?? []).includes(value.value);
                    return (
                      <button
                        key={value.value}
                        className={`chip !py-1 !px-2.5 text-[12px] ${active ? "active" : ""}`}
                        onClick={() => toggleSpec(facet.name, value.value)}
                        aria-pressed={active}
                      >
                        {value.value} <span className="opacity-60">{value.count}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-3 border border-signal rounded-[10px] px-3 py-2.5">
            <p className="text-[13px] font-semibold text-signal">Каталог не загрузился</p>
            <p className="text-[12px] text-ink-2 mt-1">{error}</p>
          </div>
        )}

        {/* Лента новинок. Стоит только в общем каталоге: в разделе покупатель
            уже сузил выбор категорией, и лента «из другого» там мешает. */}
        {!category && !search && newest.length > 0 && !loading && (
          <section className="mt-4" aria-label="Новинки">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="t-section">Новое в магазине</h2>
              <span className="t-brand">{newest.length} позиции</span>
            </div>
            {/* Полный bleed до краёв экрана: лента должна «уходить» за край,
                иначе читается как обрезанный блок. Отступ слева — внутри
                самого скролла, иначе первая карточка липла к краю. */}
            <div className="no-scrollbar edge-fade news-rail -mx-4 px-4">
              {newest.map((p) => (
                <button
                  key={p.id}
                  className="news-card"
                  onClick={() => {
                    haptic("tap");
                    props.onOpen(p.id);
                  }}
                  aria-label={`Открыть ${p.title}`}
                >
                  <div className="photo-frame">
                    <ProductImage src={p.photoUrl} alt={p.title} priority />
                  </div>
                  <div className="name">{p.title}</div>
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="amount price">{money(p.price)}</span>
                    {hasDiscount(p) && <span className="price-old">{money(p.oldPrice!)}</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Сетка товаров: линии вместо рамок у каждой карточки */}
        <section className="shelf mt-4 mb-6" aria-label="Товары">
          {loading && products.length === 0
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="shelf-cell">
                  <div className="photo-frame aspect-square rounded-[6px]" />
                  <div className="h-2.5 w-12 bg-[#efefef] rounded mt-2.5" />
                  <div className="h-3 w-full bg-[#f0f0f0] rounded mt-2" />
                  <div className="h-3 w-1/2 bg-[#f0f0f0] rounded mt-1.5" />
                </div>
              ))
            : products.map((p, index) => (
                <article key={p.id} className="shelf-cell relative">
                  <button
                    onClick={() => {
                      haptic("tap");
                      props.onOpen(p.id);
                    }}
                    className="block w-full text-left"
                    aria-label={`Открыть ${p.title}`}
                  >
                    <div className="relative">
                      <PhotoCarousel photos={p.photos?.length ? p.photos : [p.photoUrl]} title={p.title} priority={index < 4} />
                      {/* Скидка — на фото, а не в строке цены: на узкой карточке
                          «цена + старая цена + процент» переносились и рвали
                          выравнивание сетки. */}
                      {hasDiscount(p) && <span className="discount-badge">−{discountPercent(p)}%</span>}
                    </div>

                    {p.brand && <div className="t-brand mt-2.5">{p.brand}</div>}
                    <div className="t-title line-clamp-2 mt-1 min-h-[2.64em]">{p.title}</div>
                    <div className="flex items-baseline gap-1.5 whitespace-nowrap overflow-hidden">
                      <span className="t-price-lg price shrink-0">{money(p.price)}</span>
                      {hasDiscount(p) && <span className="price-old">{money(p.oldPrice!)}</span>}
                    </div>
                  </button>

                  {/* Сравнение: отдельная кнопка, чтобы не мешать переходу в карточку */}
                  <button
                    onClick={() => props.onToggleCompare(p.id)}
                    aria-pressed={props.compare.includes(p.id)}
                    aria-label={`Сравнить ${p.title}`}
                    className={`absolute top-2 right-2 h-7 w-7 rounded-[7px] border flex items-center justify-center transition-colors ${
                      props.compare.includes(p.id)
                        ? "bg-ink border-ink text-white"
                        : "bg-paper/85 border-rule text-ink-2"
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                      <path d="M4 7h10M4 17h10M17 4v16M13 11l4 2-4 2" />
                    </svg>
                  </button>
                </article>
              ))}

          {!loading && products.length === 0 && !error && (
            <div className="col-span-2 bg-paper py-10 text-center">
              <p className="text-[13px] text-ink-2">Ничего не нашлось</p>
              <p className="meta mt-1">Попробуйте изменить запрос или сбросить фильтры</p>
              {activeFilters > 0 && (
                <button className="btn-ghost mt-3" onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
