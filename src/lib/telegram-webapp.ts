"use client";

/**
 * Клиентская обёртка над Telegram WebApp SDK.
 *
 * Всё касается только браузера: открытие/расширение окна, тактильный отклик,
 * initData для запросов. Вне Telegram (обычный браузер) функции тихо ничего
 * не делают — приложение остаётся работоспособным для просмотра каталога.
 */

type HapticStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type HapticNotification = "error" | "success" | "warning";

type TelegramWebApp = {
  initData?: string;
  colorScheme?: "light" | "dark";
  ready?: () => void;
  expand?: () => void;
  close?: () => void;
  openTelegramLink?: (url: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: HapticStyle) => void;
    notificationOccurred?: (type: HapticNotification) => void;
    selectionChanged?: () => void;
  };
  BackButton?: {
    show?: () => void;
    hide?: () => void;
    onClick?: (cb: () => void) => void;
    offClick?: (cb: () => void) => void;
  };
  MainButton?: { hide?: () => void };
};

function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}

export function initTelegram(): void {
  const tg = webApp();
  if (!tg) return;
  tg.ready?.();
  tg.expand?.();
}

export function initData(): string {
  return webApp()?.initData ?? "";
}

/** Есть ли подпись Telegram: без неё корзина и заказы недоступны. */
export function inTelegram(): boolean {
  return initData().length > 0;
}

/**
 * Тактильный отклик. Уровни осмысленные: добавление в корзину — light,
 * подтверждение заказа и ошибка — notification. Подряд идущие вызовы
 * глушим: на некоторых устройствах «дребезг» раздражает сильнее, чем помогает.
 */
let lastHaptic = 0;

export function haptic(kind: "tap" | "success" | "error" | "select" = "tap"): void {
  const tg = webApp();
  const haptics = tg?.HapticFeedback;
  if (!haptics) return;

  const now = Date.now();
  if (now - lastHaptic < 60) return;
  lastHaptic = now;

  try {
    if (kind === "success") haptics.notificationOccurred?.("success");
    else if (kind === "error") haptics.notificationOccurred?.("error");
    else if (kind === "select") haptics.selectionChanged?.();
    else haptics.impactOccurred?.("light");
  } catch {
    // Старые клиенты Telegram могут не поддерживать HapticFeedback — молчим.
  }
}

/** Заголовки для запросов: подпись Telegram уходит только на сервер, в URL её нет. */
export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "Content-Type": "application/json", "x-telegram-init-data": initData(), ...extra };
}

export function useBackButton(visible: boolean, onBack: () => void): void {
  if (typeof window === "undefined") return;
  const button = webApp()?.BackButton;
  if (!button) return;
  if (visible) {
    button.show?.();
    button.onClick?.(onBack);
  } else {
    button.hide?.();
  }
}

export function closeApp(): void {
  webApp()?.close?.();
}
