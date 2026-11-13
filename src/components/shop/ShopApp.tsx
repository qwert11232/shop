"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic, initTelegram, useBackButton } from "@/lib/telegram-webapp";
import CatalogScreen from "./CatalogScreen";
import ProductScreen from "./ProductScreen";
import CartScreen, { type Cart } from "./CartScreen";
import CheckoutScreen from "./CheckoutScreen";
import AccountScreen from "./AccountScreen";
import FavoritesScreen from "./FavoritesScreen";
import CompareScreen from "./CompareScreen";

/**
 * Навигация магазина без роутера: состояния экранов живут в одном компоненте,
 * поэтому переходы мгновенные, а корзина и избранное не перезагружаются.
 * Источник правды — сервер: каждая мутация возвращает актуальную корзину.
 */
export type Tab = "catalog" | "favorites" | "cart" | "account";
export type Route =
  | { name: "catalog" }
  | { name: "product"; id: string }
  | { name: "cart" }
  | { name: "checkout" }
  | { name: "favorites" }
  | { name: "account" }
  | { name: "compare"; ids: string[] };

export default function ShopApp() {
  const [route, setRoute] = useState<Route>({ name: "catalog" });
  const [cart, setCart] = useState<Cart>({ lines: [], total: 0, count: 0, savings: 0 });
  const [compare, setCompare] = useState<string[]>([]);
  const [toast, setToast] = useState<string>("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2200);
  }, []);

  const go = useCallback((next: Route) => {
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  useEffect(() => {
    initTelegram();
  }, []);

  /**
   * Точка входа из бота: кнопка «Открыть в витрине» ведёт на `?product=<id>`.
   * Без этого покупатель попадал на каталог и искал товар руками.
   * Адрес чистим через replaceState: обновление страницы не должно возвращать
   * на тот же товар, если человек уже ушёл в другой раздел.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const product = params.get("product");
    if (!product) return;
    setRoute({ name: "product", id: product });
    params.delete("product");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, []);

  const loadCart = useCallback(async () => {
    try {
      const res = await fetch("/api/cart", { headers: { "x-telegram-init-data": initDataSafe() } });
      if (!res.ok) return;
      const data = await res.json();
      if (data.cart) setCart(data.cart);
    } catch {
      // Корзина недоступна без Telegram — это ожидаемо в браузере.
    }
  }, []);

  useEffect(() => {
    void loadCart();
  }, [loadCart]);

  const toggleCompare = useCallback(
    (id: string) => {
      haptic("select");
      setCompare((current) => {
        if (current.includes(id)) return current.filter((item) => item !== id);
        if (current.length >= 3) {
          notify("Сравнить можно до трёх моделей");
          return current;
        }
        return [...current, id];
      });
    },
    [notify],
  );

  useBackButton(route.name !== "catalog", () => go({ name: "catalog" }));

  return (
    <main className="mx-auto max-w-md min-h-dvh flex flex-col pb-20">
      <div key={route.name} className="screen-enter flex flex-col">
        {route.name === "catalog" && (
          <CatalogScreen
            onOpen={(id) => go({ name: "product", id })}
            onCart={() => go({ name: "cart" })}
            onCompare={() => compare.length >= 2 && go({ name: "compare", ids: compare })}
            compare={compare}
            onToggleCompare={toggleCompare}
            cartCount={cart.count}
          />
        )}
        {route.name === "product" && (
          <ProductScreen
            id={route.id}
            onBack={() => go({ name: "catalog" })}
            onCart={loadCart}
            onOpen={(id) => go({ name: "product", id })}
            notify={notify}
            inCompare={compare.includes(route.id)}
            onToggleCompare={toggleCompare}
            cartCount={cart.count}
          />
        )}
        {route.name === "cart" && (
          <CartScreen
            cart={cart}
            onChange={setCart}
            onCheckout={() => go({ name: "checkout" })}
            onCatalog={() => go({ name: "catalog" })}
            notify={notify}
          />
        )}
        {route.name === "checkout" && (
          <CheckoutScreen
            cart={cart}
            onDone={() => {
              void loadCart();
              go({ name: "account" });
            }}
            onBack={() => go({ name: "cart" })}
            onOpenProduct={(id) => go({ name: "product", id })}
          />
        )}
        {route.name === "favorites" && (
          <FavoritesScreen
            onOpen={(id) => go({ name: "product", id })}
            onCart={loadCart}
            notify={notify}
          />
        )}
        {route.name === "account" && (
          <AccountScreen
            onOpen={(id) => go({ name: "product", id })}
            onCatalog={() => go({ name: "catalog" })}
            notify={notify}
          />
        )}
        {route.name === "compare" && (
          <CompareScreen ids={route.ids} onBack={() => go({ name: "catalog" })} onOpen={(id) => go({ name: "product", id })} />
        )}
      </div>

      {/* Нижняя навигация: остаётся видимой, поэтому до корзины всегда один тап */}
      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-30 bg-paper border-t border-rule">
        <div className="mx-auto max-w-md grid grid-cols-4">
          <TabButton
            active={route.name === "catalog" || route.name === "product" || route.name === "compare"}
            label="Каталог"
            onClick={() => go({ name: "catalog" })}
            icon={<IconGrid />}
          />
          <TabButton
            active={route.name === "favorites"}
            label="Избранное"
            onClick={() => go({ name: "favorites" })}
            icon={<IconHeart />}
          />
          <TabButton
            active={route.name === "cart" || route.name === "checkout"}
            label="Корзина"
            onClick={() => go({ name: "cart" })}
            badge={cart.count}
            icon={<IconCart />}
          />
          <TabButton
            active={route.name === "account"}
            label="Профиль"
            onClick={() => go({ name: "account" })}
            icon={<IconUser />}
          />
        </div>
      </nav>

      {toast && (
        <div
          role="status"
          className="toast-enter fixed bottom-20 left-1/2 -translate-x-1/2 z-40 bg-ink text-white text-[13px] px-3.5 py-2 rounded-[10px] max-w-[85%] text-center"
        >
          {toast}
        </div>
      )}
    </main>
  );
}

function initDataSafe(): string {
  if (typeof window === "undefined") return "";
  return (
    (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData ?? ""
  );
}

function TabButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      onClick={() => {
        haptic("tap");
        props.onClick();
      }}
      aria-current={props.active ? "page" : undefined}
      className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
        props.active ? "text-signal" : "text-ink-2"
      }`}
    >
      {props.icon}
      {props.label}
      {props.badge ? (
        <span className="absolute top-1.5 right-[calc(50%-18px)] min-w-[16px] h-4 px-1 rounded-full bg-signal text-white text-[10px] leading-4 text-center">
          {props.badge > 9 ? "9+" : props.badge}
        </span>
      ) : null}
    </button>
  );
}

// ─── Иконки (тот же набор и штрих, что в src/components/icons.tsx) ──────────
function svgProps(size = 20) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function IconGrid() {
  return (
    <svg {...svgProps()}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg {...svgProps()}>
      <path d="M12 20s-7.5-4.6-7.5-9.4A4.1 4.1 0 0112 8.2a4.1 4.1 0 017.5 2.4C19.5 15.4 12 20 12 20z" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg {...svgProps()}>
      <path d="M3 4h2.2l2.3 10.4a1.6 1.6 0 001.6 1.3h8.5a1.6 1.6 0 001.6-1.3L21 7H6" />
      <circle cx="9.5" cy="19.5" r="1.25" />
      <circle cx="17.5" cy="19.5" r="1.25" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20.5a7.5 7.5 0 0115 0" />
    </svg>
  );
}
