"use client";

import { useEffect, useState } from "react";
import { money } from "@/lib/format";
import ProductImage from "@/components/ui/ProductImage";

type Compared = { id: string; title: string; price: number; photoUrl: string; brand: string };
type Row = { name: string; unit: string; values: (string | null)[]; better?: number };
type Comparison = { products: Compared[]; rows: Row[] };

/**
 * Сравнение 2–3 моделей одной таблицей.
 * Преимущество подсвечивается только там, где «больше» объективно лучше —
 * решает сервер (см. compareProducts), экран лишь показывает.
 */
export default function CompareScreen(props: {
  ids: string[];
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setComparison(null);
    fetch(`/api/compare?ids=${encodeURIComponent(props.ids.join(","))}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Не удалось сравнить");
        return data;
      })
      .then((data) => setComparison(data.comparison))
      .catch((e) => setError(e instanceof Error ? e.message : "Не удалось сравнить"));
  }, [props.ids]);

  if (error) {
    return (
      <div className="px-4">
        <Header onBack={props.onBack} />
        <p className="text-[13px] mt-4">{error}</p>
        <button className="btn-ghost mt-3" onClick={props.onBack}>В каталог</button>
      </div>
    );
  }

  if (!comparison) {
    return (
      <div className="px-4">
        <Header onBack={props.onBack} />
        <p className="meta mt-4">Сравниваем…</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-6">
      <Header onBack={props.onBack} />

      {/* Горизонтальная прокрутка: две модели помещаются целиком, три — листаются */}
      <div className="mt-3 overflow-x-auto no-scrollbar border border-rule rounded-[14px]">
        <table className="w-full border-collapse text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-paper w-[92px] min-w-[92px] border-b border-rule p-2 text-left align-bottom">
                <span className="meta">Модель</span>
              </th>
              {comparison.products.map((product) => (
                <th key={product.id} className="border-b border-rule p-2 align-bottom min-w-[124px]">
                  <button onClick={() => props.onOpen(product.id)} className="block text-left w-full">
                    <div className="photo-frame aspect-square rounded-[8px] mb-1.5">
                      <ProductImage src={product.photoUrl} alt={product.title} className="h-full w-full object-contain p-1" />
                    </div>
                    <div className="meta">{product.brand}</div>
                    <div className="font-semibold leading-tight line-clamp-2">{product.title}</div>
                    <div className="price mt-1">{money(product.price)}</div>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row, index) => {
              // Разные значения — строка что-то объясняет, подсвечиваем только её
              const distinct = new Set(row.values.map((v) => v ?? "—")).size > 1;
              return (
                <tr key={row.name} className={index % 2 ? "bg-[#fafafa]" : ""}>
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 text-left font-normal text-ink-2 p-2 border-b border-rule ${
                      index % 2 ? "bg-[#fafafa]" : "bg-paper"
                    }`}
                  >
                    {row.name}
                    {row.unit ? `, ${row.unit}` : ""}
                  </th>
                  {row.values.map((value, i) => {
                    const isBest = row.better === i && row.values[row.better] !== null;
                    return (
                      <td
                        key={`${row.name}-${i}`}
                        className={`p-2 border-b border-rule align-top ${
                          isBest ? "font-semibold text-signal" : distinct ? "" : "text-ink-2"
                        }`}
                      >
                        {value ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="meta mt-2">Красным отмечены значения, которые объективно лучше</p>
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <header className="app-header -mx-4 px-4 py-2.5 flex items-center gap-1">
      <button className="icon-btn" onClick={onBack} aria-label="Назад">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <span className="font-display font-bold text-[15px]">Сравнение</span>
    </header>
  );
}
