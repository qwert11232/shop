"use client";

import { useEffect, useMemo, useState } from "react";
import { apiHeaders, haptic } from "@/lib/telegram-webapp";
import { formatPhone, money } from "@/lib/format";
import type { Cart } from "./CartScreen";

type Order = {
  id: string;
  total: number;
  bonusUsed: number;
  bonusEarned: number;
};

/**
 * Оформление в один экран: имя и username уже известны из Telegram,
 * телефон спрашиваем один раз и запоминаем в профиле.
 * Бонусы можно списать ползунком — предел считает сервер, не браузер.
 */
export default function CheckoutScreen(props: {
  cart: Cart;
  onDone: () => void;
  onBack: () => void;
  onOpenProduct: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [balance, setBalance] = useState(0);
  const [useBonus, setUseBonus] = useState(false);
  const [bonusAmount, setBonusAmount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    fetch("/api/me", { headers: apiHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (d.customer) {
          setName(d.customer.firstName ?? "");
          setPhone(formatPhone(d.customer.phone ?? ""));
          setBalance(Number(d.customer.bonusBalance ?? 0));
        }
      })
      .catch(() => setError("Профиль недоступен"))
      .finally(() => setLoading(false));
  }, []);

  const cap = useMemo(
    () => Math.max(0, Math.min(balance, Math.floor(props.cart.total * 0.3))),
    [balance, props.cart.total],
  );

  useEffect(() => {
    setBonusAmount(cap);
    setUseBonus(cap > 0);
  }, [cap]);

  const payable = props.cart.total - (useBonus ? bonusAmount : 0);

  async function submit() {
    if (sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          contactName: name,
          phone,
          comment,
          useBonus: useBonus && bonusAmount > 0,
          bonusAmount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Не удалось оформить заказ");
      haptic("success");
      setOrder(data.order);
    } catch (e) {
      haptic("error");
      setError(e instanceof Error ? e.message : "Не удалось оформить заказ");
    } finally {
      setSending(false);
    }
  }

  if (order) {
    return (
      <div className="px-4">
        <div className="mt-8 text-center">
          <div className="mx-auto h-12 w-12 rounded-full border border-ink flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h1 className="font-display font-bold text-[18px] mt-3">Заказ оформлен</h1>
          <p className="text-[13px] text-ink-2 mt-1">
            Номер {order.id}. Статус сборки и трек-номер появятся в профиле.
          </p>
        </div>

        <div className="border border-rule rounded-[14px] p-3 mt-4">
          <Row label="К оплате" value={money(order.total)} />
          {order.bonusUsed > 0 && <Row label="Списано бонусов" value={`−${money(order.bonusUsed)}`} />}
          {order.bonusEarned > 0 && <Row label="Начислено бонусов" value={`+${money(order.bonusEarned)}`} />}
        </div>

        <button className="btn-primary w-full mt-4" onClick={props.onDone}>
          Мои заказы
        </button>
        <p className="meta text-center mt-2">Связаться с магазином можно в чате бота</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-6">
      <header className="app-header -mx-4 px-4 py-2.5 flex items-center gap-1">
        <button className="icon-btn" onClick={props.onBack} aria-label="Назад">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <span className="font-display font-bold text-[15px]">Оформление</span>
      </header>

      <section className="mt-3">
        <div className="label">Получатель</div>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={loading ? "Загружаем…" : "Имя"}
          aria-label="Имя получателя"
          maxLength={60}
        />
        <p className="meta mt-1">Имя подставлено из Telegram — можно поправить</p>
      </section>

      <section className="mt-3">
        <div className="label">Телефон для доставки</div>
        <input
          className="input"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          placeholder="+7 900 000-00-00"
          inputMode="tel"
          aria-label="Телефон"
          aria-invalid={phone.length > 0 && phone.replace(/\D/g, "").length < 11}
        />
      </section>

      {balance > 0 && (
        <section className="mt-3 border border-rule rounded-[14px] p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold">Списать бонусы</div>
              <div className="meta">Доступно {money(balance)} · максимум 30% суммы</div>
            </div>
            <button
              role="switch"
              aria-checked={useBonus}
              aria-label="Списать бонусы"
              onClick={() => {
                haptic("select");
                setUseBonus((v) => !v);
              }}
              className={`h-6 w-10 rounded-full border transition-colors ${useBonus ? "bg-ink border-ink" : "bg-[#e9e9e9] border-rule"}`}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-paper border border-rule transition-transform ${useBonus ? "translate-x-[18px]" : "translate-x-[2px]"}`}
              />
            </button>
          </div>
          {useBonus && cap > 0 && (
            <div className="mt-2.5">
              <input
                type="range"
                min={0}
                max={cap}
                step={1000}
                value={bonusAmount}
                onChange={(e) => setBonusAmount(Number(e.target.value))}
                aria-label="Сумма списания бонусов"
                className="w-full accent-[#e00b20]"
              />
              <div className="flex justify-between meta">
                <span>0 ₽</span>
                <span>{money(bonusAmount)}</span>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="mt-3">
        <div className="label">Комментарий</div>
        <textarea
          className="input min-h-[64px] resize-none"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Пожелания к заказу, удобное время"
          maxLength={500}
          aria-label="Комментарий к заказу"
        />
      </section>

      <section className="mt-4 border border-ink rounded-[14px] p-3">
        <ul className="flex flex-col gap-1.5">
          {props.cart.lines.map((line) => (
            <li key={`${line.productId}:${line.variantId ?? ""}`} className="flex justify-between gap-2 text-[12px]">
              <span className="text-ink-2 line-clamp-1">
                {line.title}
                {line.variantLabel ? ` · ${line.variantLabel}` : ""} × {line.quantity}
              </span>
              <span className="tabular-nums shrink-0">{money(line.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="h-px bg-rule my-2.5" />
        {useBonus && bonusAmount > 0 && <Row label="Бонусами" value={`−${money(bonusAmount)}`} />}
        <div className="flex justify-between items-baseline">
          <span className="text-[14px] font-semibold">Итого</span>
          <span className="price text-[20px]">{money(Math.max(0, payable))}</span>
        </div>
        <div className="meta mt-1">Начислим кешбэк 3% — {money(Math.round(payable * 0.03))}</div>
      </section>

      {error && (
        <div className="mt-3 border border-signal rounded-[10px] px-3 py-2 text-[12px] text-signal">{error}</div>
      )}

      <button className="btn-primary w-full mt-4" onClick={submit} disabled={sending || loading}>
        {sending ? "Оформляем…" : "Подтвердить заказ"}
      </button>
      <p className="meta text-center mt-2">
        Нажимая кнопку, вы соглашаетесь на обработку данных для доставки
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[12px]">
      <span className="text-ink-2">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
