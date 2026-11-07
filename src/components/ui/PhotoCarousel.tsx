"use client";

import { useRef, useState } from "react";
import ProductImage from "./ProductImage";

/**
 * Карусель кадров товара прямо в сетке каталога.
 *
 * Зачем: у товара теперь несколько живых кадров (прилавок, рука продавца,
 * витрина), и листать их хочется, не открывая карточку. Карусель лежит внутри
 * кнопки «открыть товар», поэтому свайп не должен её нажимать: жест
 * распознаётся по сдвигу и порогу, а клик гасится, только если был свайп.
 *
 * Прокрутка — нативная (`overflow-x-auto` + `snap`): на iOS она инерционная и
 * не блокирует вертикальный скролл страницы, чего не добиться ручным drag.
 */
export default function PhotoCarousel({
  photos,
  title,
  priority = false,
  className = "",
}: {
  photos: string[];
  title: string;
  priority?: boolean;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);
  const swiped = useRef(false);

  const count = photos.length;

  return (
    <div className={`relative ${className}`}>
      <div
        className="photo-frame aspect-square rounded-[6px] relative overflow-hidden"
        // Клик после свайпа не должен открывать товар: на iOS жест листания
        // заканчивается тем же тапом, что и переход.
        onClickCapture={(event) => {
          if (swiped.current) {
            event.preventDefault();
            event.stopPropagation();
            swiped.current = false;
          }
        }}
        onPointerDown={(e) => {
          startX.current = e.clientX;
          swiped.current = false;
        }}
        onPointerMove={(e) => {
          if (startX.current !== null && Math.abs(e.clientX - startX.current) > 8) swiped.current = true;
        }}
        onPointerUp={() => {
          startX.current = null;
        }}
      >
        <div
          className="no-scrollbar flex h-full w-full overflow-x-auto snap-x snap-mandatory"
          onScroll={(e) => {
            const width = e.currentTarget.clientWidth;
            if (!width) return;
            setIndex(Math.round(e.currentTarget.scrollLeft / width));
          }}
        >
          {photos.map((url, i) => (
            <div key={`${url}-${i}`} className="min-w-full snap-center h-full">
              <ProductImage
                src={url}
                alt={`${title} — фото ${i + 1}`}
                priority={priority && i === 0}
                className="h-full w-full object-cover"
                wrapperClassName="h-full w-full"
              />
            </div>
          ))}
        </div>

        {count > 1 && (
          <>
            {/* Точки: сколько кадров и где вы сейчас. Тап по точке — переход. */}
            <div className="absolute bottom-1.5 left-0 right-0 flex justify-center gap-1">
              {photos.map((_, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={`h-1 rounded-full transition-all ${
                    i === index ? "w-3.5 bg-ink" : "w-1 bg-ink/25"
                  }`}
                />
              ))}
            </div>
            <span className="absolute top-2 left-2 rounded-[4px] bg-paper/85 px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums text-ink-2">
              {index + 1}/{count}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
