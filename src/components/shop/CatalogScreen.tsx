"use client";

import { useEffect, useMemo, useState } from "react";
import { haptic } from "@/lib/telegram-webapp";
import { money } from "@/lib/format";

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  photoUrl: string;
  categoryId: string;
  brand: string;
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
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  }, [category, search, sort, selectedBrands, selectedSpecs, priceRange]);

  const activeFilters = useMemo(
    () =>
      selectedBrands.length +
      Object.values(selectedSpecs).reduce((sum, values) => sum + values.length, 0) +
      (priceRange.min || priceRange.max ? 1 : 0),
    [selectedBrands, selectedSpecs, priceRange],
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
  }

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 bg-paper border-b border-ink">
        <div className="px-4 pt-3 pb-2.5 flex items-center gap-2">
          <span className="font-display font-bold text-[15px]">ТЕХНОЛАБ</span>
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

        {/* Поиск: сразу под шапкой, на всю ширину */}
        <div className="px-4 pb-2.5">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-2"
              width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input
              className="input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Найти технику или бренд"
              inputMode="search"
              aria-label="Поиск по каталогу"
            />
            {search && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 icon-btn"
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
        {/* Категории */}
        <nav className="no-scrollbar flex gap-2 overflow-x-auto mt-3 -mx-4 px-4 pb-1" aria-label="Категории">
          <button
            className={`chip ${category === "" ? "active" : ""}`}
            onClick={() => {
              haptic("select");
              setCategory("");
            }}
            aria-pressed={category === ""}
          >
            Все
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`chip ${category === c.id ? "active" : ""}`}
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

        {/* Строка управления: сортировка и фильтры */}
        <div className="flex items-center gap-2 mt-3">
          <label className="sr-only" htmlFor="sort">Сортировка</label>
          <select
            id="sort"
            className="input !w-auto !py-1.5 text-[13px]"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <button
            className={`chip ${activeFilters ? "active" : ""}`}
            onClick={() => {
              haptic("tap");
              setFiltersOpen((open) => !open);
            }}
            aria-expanded={filtersOpen}
          >
            Фильтры{activeFilters ? ` · ${activeFilters}` : ""}
          </button>
          <span className="flex-1" />
          <span className="meta">{loading ? "ищем…" : `${products.length} шт.`}</span>
        </div>

        {filtersOpen && (
          <div className="mt-3 border border-ink rounded-[14px] p-3">
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

        {/* Сетка товаров */}
        <section className="grid grid-cols-2 gap-3 mt-3 mb-6">
          {loading && products.length === 0
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-[14px] border border-rule overflow-hidden">
                  <div className="aspect-square bg-[#f4f4f4]" />
                  <div className="p-2.5 space-y-2">
                    <div className="h-3 bg-[#f0f0f0] rounded" />
                    <div className="h-3 w-1/2 bg-[#f0f0f0] rounded" />
                  </div>
                </div>
              ))
            : products.map((p) => (
                <article key={p.id} className="card text-left relative">
                  <button
                    onClick={() => {
                      haptic("tap");
                      props.onOpen(p.id);
                    }}
                    className="block w-full text-left"
                    aria-label={`Открыть ${p.title}`}
                  >
                    <div className="aspect-square bg-[#f6f6f6]">
                      <img src={p.photoUrl} alt={p.title} className="h-full w-full object-contain p-2" loading="lazy" />
                    </div>
                    <div className="p-2.5 border-t border-rule">
                      {p.brand && <div className="meta mb-0.5">{p.brand}</div>}
                      <div className="text-[13px] font-semibold leading-snug line-clamp-2 min-h-[2.1em]">{p.title}</div>
                      <div className="price text-[14px] mt-1.5">{money(p.price)}</div>
                    </div>
                  </button>

                  {/* Сравнение: отдельная кнопка, чтобы не мешать переходу в карточку */}
                  <button
                    onClick={() => props.onToggleCompare(p.id)}
                    aria-pressed={props.compare.includes(p.id)}
                    aria-label={`Сравнить ${p.title}`}
                    className={`absolute top-2 right-2 h-8 w-8 rounded-[10px] border flex items-center justify-center transition-colors ${
                      props.compare.includes(p.id)
                        ? "bg-ink border-ink text-white"
                        : "bg-paper/90 border-rule text-ink-2"
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                      <path d="M4 7h10M4 17h10M17 4v16M13 11l4 2-4 2" />
                    </svg>
                  </button>
                </article>
              ))}

          {!loading && products.length === 0 && !error && (
            <div className="col-span-2 border border-rule rounded-[14px] py-10 text-center">
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
