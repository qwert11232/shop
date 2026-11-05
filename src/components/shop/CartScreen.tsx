"use client";

import { useEffect, useRef, useState } from "react";
import { apiHeaders, haptic } from "@/lib/telegram-webapp";
import { money, plural } from "@/lib/format";
import ProductImage from "@/components/ui/ProductImage";

export type CartLine = {
  productId: string;
  title: string;
  photoUrl: string;
  variantId: string | null;
  variantLabel: string;
  basePrice: number;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};
export type Cart = { lines: CartLine[]; total: number; count: number };

/**
 * Корзина: количество меняется на месте, удаление — свайпом влево.
 * Каждая операция возвращает корзину с сервера, поэтому сумма на экране
 * не может разойтись с суммой к оплате.
 */
export default function CartScreen(props: {
  cart: Cart;
  onChange: (cart: Cart) => void;
  onCheckout: () => void;
  onCatalog: () => void;
  notify: (text: string) => void;
}) {
  const [busyKey, setBusyKey] = useState<string>("");
  const [error, setError] = useState("");

  async function mutate(line: CartLine, quantity: number) {
    const key = `${line.productId}:${line.variantId ?? ""}`;
    setBusyKey(key);
    try {
      const action = quantity <= 0 ? "remove" : "set";
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          action,
          productId: line.productId,
          variantId: line.variantId,
          quantity: Math.max(0, quantity),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось изменить корзину");
      props.onChange(data.cart);
      setError("");
      if (quantity <= 0) props.notify("Удалено из корзины");
    } catch (e) {
      haptic("error");
      setError(e instanceof Error ? e.message : "Не удалось изменить корзину");
    } finally {
      setBusyKey("");
    }
  }

  if (props.cart.lines.length === 0) {
    return (
      <div className="px-4">
        <ScreenHeader title="Корзина" />
        <div className="border border-rule rounded-[14px] py-12 text-center mt-4">
          <p className="text-[14px] font-semibold">Корзина пуста</p>
          <p className="meta mt-1">Добавьте технику из каталога — она сохранится до оформления</p>
          <button className="btn-primary mt-4 mx-auto" onClick={props.onCatalog}>В каталог</button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4">
      <ScreenHeader title={`Корзина · ${props.cart.count} ${plural(props.cart.count, "товар", "товара", "товаров")}`} />

      {error && (
        <div className="mt-3 border border-signal rounded-[10px] px-3 py-2 text-[12px] text-signal">{error}</div>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {props.cart.lines.map((line) => (
          <SwipeRow
            key={`${line.productId}:${line.variantId ?? ""}`}
            onDelete={() => mutate(line, 0)}
            disabled={busyKey === `${line.productId}:${line.variantId ?? ""}`}
          >
            <div className="flex gap-2.5 p-2.5 bg-paper">
              <div className="h-[68px] w-[68px] shrink-0 rounded-[10px] bg-[#f6f6f6]">
                <ProductImage src={line.photoUrl} alt={line.title} className="h-full w-full object-contain p-1" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold leading-snug line-clamp-2">{line.title}</div>
                {line.variantLabel && <div className="meta mt-0.5">{line.variantLabel}</div>}
                <div className="flex items-end gap-2 mt-1.5">
                  <Stepper
                    value={line.quantity}
                    onChange={(next) => mutate(line, next)}
                    disabled={busyKey === `${line.productId}:${line.variantId ?? ""}`}
                  />
                  <span className="flex-1" />
                  <span className="price text-[14px]">{money(line.lineTotal)}</span>
                </div>
              </div>
            </div>
          </SwipeRow>
        ))}
      </ul>

      <p className="meta mt-2">Смахните позицию влево, чтобы удалить</p>

      <div className="mt-4 border border-ink rounded-[14px] p-3">
        <div className="flex justify-between text-[13px]">
          <span className="text-ink-2">Товары</span>
          <span>{money(props.cart.total)}</span>
        </div>
        <div className="flex justify-between text-[13px] mt-1">
          <span className="text-ink-2">Доставка</span>
          <span>обсудим в чате</span>
        </div>
        <div className="h-px bg-rule my-2.5" />
        <div className="flex justify-between items-baseline">
          <span className="text-[14px] font-semibold">К оплате</span>
          <span className="price text-[20px]">{money(props.cart.total)}</span>
        </div>
        <button className="btn-primary w-full mt-3" onClick={props.onCheckout}>
          Оформить заказ
        </button>
        <p className="meta text-center mt-2">Имя и телефон подставим из Telegram</p>
      </div>
    </div>
  );
}

function ScreenHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-20 bg-paper border-b border-ink -mx-4 px-4 py-2.5">
      <span className="font-display font-bold text-[15px]">{title}</span>
    </header>
  );
}

function Stepper(props: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center border border-rule rounded-[10px] overflow-hidden">
      <button
        className="h-7 w-7 flex items-center justify-center disabled:opacity-40"
        onClick={() => {
          haptic("tap");
          props.onChange(props.value - 1);
        }}
        disabled={props.disabled}
        aria-label="Уменьшить количество"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M5 12h14" />
        </svg>
      </button>
      <span className="w-7 text-center text-[13px] tabular-nums">{props.value}</span>
      <button
        className="h-7 w-7 flex items-center justify-center disabled:opacity-40"
        onClick={() => {
          haptic("tap");
          props.onChange(props.value + 1);
        }}
        disabled={props.disabled || props.value >= 99}
        aria-label="Увеличить количество"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M5 12h14M12 5v14" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Свайп-удаление без библиотек: тянем строку влево указателем,
 * дальше 64 px отпускаем — удаляем. Порог нужен, чтобы не удалить случайно.
 */
function SwipeRow(props: { children: React.ReactNode; onDelete: () => void; disabled?: boolean }) {
  const [offset, setOffset] = useState(0);
  const start = useRef<number | null>(null);
  const width = 88;

  useEffect(() => {
    if (props.disabled) setOffset(0);
  }, [props.disabled]);

  function onPointerDown(e: React.PointerEvent) {
    start.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (start.current === null) return;
    const delta = e.clientX - start.current;
    if (delta < 0) setOffset(Math.max(-width, delta));
  }

  function onPointerUp() {
    if (start.current === null) return;
    start.current = null;
    if (offset < -64) {
      haptic("tap");
      props.onDelete();
    }
    setOffset(0);
  }

  return (
    <li className="relative overflow-hidden rounded-[14px] border border-rule">
      <button
        tabIndex={-1}
        aria-hidden
        className="absolute inset-y-0 right-0 w-[88px] bg-signal text-white text-[12px] font-semibold flex items-center justify-center"
        onClick={props.onDelete}
      >
        Удалить
      </button>
      <div
        className="relative transition-transform"
        style={{ transform: `translateX(${offset}px)`, transitionDuration: start.current === null ? "140ms" : "0ms" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {props.children}
        {/* Дублирующая кнопка: свайп на десктопе недоступен */}
        <button
          className="absolute top-1.5 right-1.5 icon-btn text-ink-3"
          onClick={props.onDelete}
          aria-label="Удалить из корзины"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </li>
  );
}
