"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Картинка товара с честным состоянием загрузки.
 *
 * Зачем не `<img>` напрямую: каталог в Telegram открывается на мобильном
 * интернете, и пока фото не пришло, в плитке была пустота — витрина выглядела
 * «пустой» хотя данные уже на экране. Здесь вместо пустоты серая подложка
 * (совпадает с фоном карточки, поэтому нет скачка вёрстки) и мягкое появление
 * картинки после загрузки.
 *
 * `priority` — для первого экрана: такие фото грузятся сразу и не ждут
 * пересечения с вьюпортом, иначе первый экран мигает при прокрутке.
 */

type Props = {
  src: string;
  alt: string;
  className?: string;
  /** Обёртка и подложка: обычно квадрат с фоном карточки. */
  wrapperClassName?: string;
  priority?: boolean;
  sizes?: string;
};

export default function ProductImage({
  src,
  alt,
  className = "h-full w-full object-contain p-2",
  wrapperClassName = "h-full w-full",
  priority = false,
  sizes,
}: Props) {
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Смена товара (например, в галерее) должна снова показать подложку.
  useEffect(() => {
    setState("loading");
    // Фото из кэша загружается раньше гидратации, и тогда `onLoad` не придёт —
    // без этой проверки картинка навсегда осталась бы прозрачной.
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setState("done");
  }, [src]);

  return (
    <div className={`relative overflow-hidden ${wrapperClassName}`}>
      {state !== "done" && (
        <div
          className="absolute inset-0 animate-pulse bg-[#f1f1ef]"
          aria-hidden="true"
        />
      )}
      {state === "error" ? (
        <div className="absolute inset-0 grid place-items-center text-center text-[11px] leading-tight text-[#8a8a85]">
          Фото<br />не загрузилось
        </div>
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          sizes={sizes}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onLoad={() => setState("done")}
          onError={() => setState("error")}
          className={`${className} relative transition-opacity duration-300 ${
            state === "done" ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}
