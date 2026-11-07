"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiHeaders, haptic, inTelegram } from "@/lib/telegram-webapp";
import { formatPhone, money, shortDate } from "@/lib/format";
import {
  DELIVERY_LABEL,
  DELIVERY_STEPS,
  deliveryStepIndex,
  type DeliveryStatus,
} from "@/lib/order-status";

/** Обёртки над общим модулем: подписи нужны и как массив шагов, и как словарь. */
const deliverySteps = () => DELIVERY_STEPS;
const deliveryLabels = (): Record<string, string> => ({ ...DELIVERY_LABEL } satisfies Record<DeliveryStatus, string>);

type Customer = {
  tgUserId: string;
  firstName: string;
  username: string;
  phone: string;
  bonusBalance: number;
  referralCode: string;
  referredBy: string | null;
};
type BonusEvent = { id: string; amount: number; reason: string; createdAt: number };
type OrderItem = { title: string; variant: string; price: number; quantity: number; productId: string };
type Order = {
  id: string;
  createdAt: string;
  total: number;
  deliveryStatus: string;
  trackNumber: string;
  items: OrderItem[];
};

/** Шаги и подписи — из общего модуля, чтобы бот и витрина говорили одинаково. */
const STEPS = deliverySteps();

const STATUS_LABEL: Record<string, string> = deliveryLabels();

/** Кабинет: профиль из Telegram, бонусы, реферал, заказы со статусами доставки. */
export default function AccountScreen(props: {
  onOpen: (id: string) => void;
  onCatalog: () => void;
  notify: (text: string) => void;
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [events, setEvents] = useState<BonusEvent[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneEditing, setPhoneEditing] = useState(false);
  const [referralInput, setReferralInput] = useState("");
  const [referralBusy, setReferralBusy] = useState(false);
  const [tab, setTab] = useState<"orders" | "bonus">("orders");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, ordersRes] = await Promise.all([
        fetch("/api/me", { headers: apiHeaders() }),
        fetch("/api/me/orders", { headers: apiHeaders() }),
      ]);
      if (meRes.status === 401) {
        setAuthError(true);
        return;
      }
      const meData = await meRes.json();
      const ordersData = ordersRes.ok ? await ordersRes.json() : { orders: [] };
      if (!meRes.ok) throw new Error(meData.error ?? "Профиль недоступен");
      setCustomer(meData.customer);
      setEvents(meData.bonusEvents ?? []);
      setOrders(ordersData.orders ?? []);
      setPhone(formatPhone(meData.customer?.phone ?? ""));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Профиль недоступен");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!inTelegram()) {
      setAuthError(true);
      setLoading(false);
      return;
    }
    void load();
  }, [load]);

  const usedBonus = useMemo(
    () => events.filter((e) => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0),
    [events],
  );

  async function savePhone() {
    try {
      const res = await fetch("/api/me", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ action: "phone", phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось сохранить телефон");
      setPhoneEditing(false);
      haptic("success");
      props.notify("Телефон сохранён");
    } catch (e) {
      haptic("error");
      props.notify(e instanceof Error ? e.message : "Не удалось сохранить телефон");
    }
  }

  async function applyReferral() {
    if (referralBusy || !referralInput.trim()) return;
    setReferralBusy(true);
    try {
      const res = await fetch("/api/me", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ action: "referral", code: referralInput }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.reason ?? data.error ?? "Код не принят");
      haptic("success");
      props.notify("Код принят: бонусы начислены");
      setReferralInput("");
      await load();
    } catch (e) {
      haptic("error");
      props.notify(e instanceof Error ? e.message : "Код не принят");
    } finally {
      setReferralBusy(false);
    }
  }

  async function shareReferral() {
    if (!customer) return;
    const text = `Магазин техники ТЕХНОЛАБ. Мой код на 500 бонусов: ${customer.referralCode}`;
    const link = `https://t.me/share/url?url=${encodeURIComponent("https://t.me")}&text=${encodeURIComponent(text)}`;
    const tg = (window as unknown as { Telegram?: { WebApp?: { openTelegramLink?: (url: string) => void } } })
      .Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(link);
      return;
    }
    try {
      await navigator.clipboard.writeText(customer.referralCode);
      props.notify("Код скопирован");
    } catch {
      props.notify(`Ваш код: ${customer.referralCode}`);
    }
  }

  if (authError) {
    return (
      <div className="px-4">
        <Header />
        <div className="border border-rule rounded-[14px] p-4 mt-4">
          <p className="text-[14px] font-semibold">Нужен Telegram</p>
          <p className="text-[13px] text-ink-2 mt-1 leading-relaxed">
            Кабинет открывается внутри Telegram: там подпись подтверждает, что это вы. Вне Telegram
            доступен только просмотр каталога.
          </p>
          <button className="btn-primary mt-3" onClick={props.onCatalog}>Смотреть каталог</button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-4">
        <Header />
        <p className="meta mt-4">Загружаем профиль…</p>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="px-4">
        <Header />
        <div className="mt-4 border border-signal rounded-[10px] px-3 py-2.5">
          <p className="text-[13px] font-semibold text-signal">Профиль не загрузился</p>
          <p className="meta mt-1">{error || "Неизвестная ошибка"}</p>
          <button className="btn-ghost mt-2" onClick={load}>Повторить</button>
        </div>
      </div>
    );
  }

  const displayName = customer.firstName || (customer.username ? `@${customer.username}` : "Покупатель");

  return (
    <div className="px-4 pb-6">
      <Header />

      <section className="flex items-center gap-3 mt-3">
        <div className="h-11 w-11 rounded-full bg-ink text-white flex items-center justify-center font-display font-bold text-[16px]">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold truncate">{displayName}</div>
          <div className="meta truncate">
            {customer.username ? `@${customer.username} · ` : ""}ID {customer.tgUserId}
          </div>
        </div>
      </section>

      {/* Виртуальная карта лояльности */}
      <section className="mt-3 rounded-[14px] bg-ink text-white p-3.5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.06em] text-white/60">Бонусная карта</div>
            <div className="font-display font-bold text-[26px] leading-tight mt-0.5">
              {money(customer.bonusBalance)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-white/60">Кешбэк</div>
            <div className="text-[14px] font-semibold">3%</div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/15">
          <span className="text-[11px] text-white/70 tabular-nums tracking-[0.18em]">
            {customer.referralCode}
          </span>
          <button
            className="text-[12px] font-semibold text-white border-b border-white/50 leading-tight"
            onClick={shareReferral}
          >
            Пригласить друга
          </button>
        </div>
      </section>

      {!customer.referredBy && (
        <section className="mt-3 border border-rule rounded-[14px] p-3">
          <div className="text-[13px] font-semibold">Есть код друга?</div>
          <div className="meta mt-0.5">Вам начислим 300 бонусов, пригласившему — 500</div>
          <div className="flex gap-2 mt-2">
            <input
              className="input uppercase"
              value={referralInput}
              onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
              placeholder="КОД"
              maxLength={8}
              aria-label="Реферальный код"
            />
            <button className="btn-ghost shrink-0" onClick={applyReferral} disabled={referralBusy}>
              Применить
            </button>
          </div>
        </section>
      )}

      <section className="mt-3">
        <div className="label">Телефон для доставки</div>
        {phoneEditing ? (
          <div className="flex gap-2">
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              inputMode="tel"
              placeholder="+7 900 000-00-00"
              aria-label="Телефон"
            />
            <button className="btn-primary shrink-0" onClick={savePhone}>Сохранить</button>
          </div>
        ) : (
          <button className="flex items-center justify-between w-full input text-left" onClick={() => setPhoneEditing(true)}>
            <span className={customer.phone ? "" : "text-ink-3"}>
              {customer.phone ? formatPhone(customer.phone) : "Добавить телефон"}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </section>

      <div className="flex gap-1 mt-5 border-b border-rule" role="tablist">
        {(
          [
            ["orders", `Заказы${orders.length ? ` · ${orders.length}` : ""}`],
            ["bonus", "Бонусы"],
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

      {tab === "orders" && (
        <div className="mt-3 flex flex-col gap-2.5">
          {orders.length === 0 && (
            <div className="empty">
              <p className="text-[13px] text-ink-2">Заказов пока нет</p>
              <button className="btn-ghost mt-3" onClick={props.onCatalog}>Выбрать технику</button>
            </div>
          )}
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} onOpen={props.onOpen} />
          ))}
        </div>
      )}

      {tab === "bonus" && (
        <div className="mt-3">
          <div className="flex gap-3">
            <div className="flex-1 border border-rule rounded-[12px] p-2.5">
              <div className="meta">Начислено</div>
              <div className="text-[15px] font-semibold mt-0.5">{money(customer.bonusBalance)}</div>
            </div>
            <div className="flex-1 border border-rule rounded-[12px] p-2.5">
              <div className="meta">Списано</div>
              <div className="text-[15px] font-semibold mt-0.5">{money(usedBonus)}</div>
            </div>
          </div>
          <ul className="mt-3 flex flex-col">
            {events.length === 0 && <li className="meta">История пуста</li>}
            {events.map((event) => (
              <li key={event.id} className="flex justify-between gap-2 py-2 border-b border-rule last:border-0">
                <div className="min-w-0">
                  <div className="text-[13px] leading-snug">{event.reason}</div>
                  <div className="meta">{shortDate(event.createdAt)}</div>
                </div>
                <span className={`text-[13px] font-semibold tabular-nums ${event.amount < 0 ? "text-ink-2" : "text-signal"}`}>
                  {event.amount > 0 ? "+" : "−"}
                  {money(Math.abs(event.amount))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="app-header -mx-4 px-4 py-2.5">
      <span className="font-display font-bold text-[15px]">Профиль</span>
    </header>
  );
}

/** Карточка заказа: прогресс доставки по шагам, трек-номер и позиции. */
function OrderCard({ order, onOpen }: { order: Order; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const cancelled = order.deliveryStatus === "cancelled";
  const activeIndex = deliveryStepIndex(order.deliveryStatus);

  return (
    <article className="border border-rule rounded-[14px] p-3">
      <button className="w-full text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold">№ {order.id}</div>
            <div className="meta mt-0.5">{shortDate(order.createdAt)}</div>
          </div>
          <div className="text-right">
            <div className="price text-[14px]">{money(order.total)}</div>
            <div
              className={`text-[12px] font-semibold mt-0.5 ${
                cancelled ? "text-ink-2" : order.deliveryStatus === "new" ? "text-signal" : "text-ink"
              }`}
            >
              {STATUS_LABEL[order.deliveryStatus] ?? order.deliveryStatus}
            </div>
          </div>
        </div>

        {!cancelled && (
          <div className="mt-2.5 flex items-center gap-1" aria-label="Ход доставки">
            {STEPS.map((step, index) => (
              <div key={step.key} className="flex-1">
                <div className={`h-1 rounded-full ${index <= activeIndex ? "bg-signal" : "bg-rule"}`} />
                <div className={`mt-1 text-[10px] leading-tight ${index <= activeIndex ? "text-ink" : "text-ink-3"}`}>
                  {step.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </button>

      {order.deliveryStatus === "new" && (
        <p className="mt-2 text-[12px] leading-snug text-ink-2">
          Менеджер подтвердит заказ и пришлёт сумму к оплате — обычно в течение рабочего дня.
        </p>
      )}
      {order.deliveryStatus === "confirmed" && (
        <p className="mt-2 text-[12px] leading-snug text-ink-2">
          Заказ подтверждён. Оплатите по реквизитам, которые пришлёт менеджер, — после оплаты начнём сборку.
        </p>
      )}
      {order.trackNumber && (
        <div className="mt-2.5 flex items-center justify-between border border-rule rounded-[10px] px-2.5 py-1.5">
          <span className="meta">Трек-номер</span>
          <span className="text-[12px] font-semibold tabular-nums">{order.trackNumber}</span>
        </div>
      )}

      {open && (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {order.items.map((item, index) => (
            <li key={`${item.productId}-${index}`} className="flex justify-between gap-2 text-[12px]">
              <button className="text-left line-clamp-1 text-ink-2" onClick={() => onOpen(item.productId)}>
                {item.title}
                {item.variant ? ` · ${item.variant}` : ""} × {item.quantity}
              </button>
              <span className="tabular-nums shrink-0">{money(item.price * item.quantity)}</span>
            </li>
          ))}
          {order.deliveryStatus === "done" && (
            <li className="meta mt-1">Отзыв можно оставить в карточке полученного товара</li>
          )}
        </ul>
      )}
    </article>
  );
}
