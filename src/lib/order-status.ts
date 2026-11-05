/**
 * Статусы заказа — один источник правды для витрины, бота и сообщений.
 *
 * Зачем отдельный модуль: раньше подписи жили в трёх местах (карточка заказа
 * в боте, кабинет на витрине, текст сообщения администратору) и расходились —
 * клиент видел «Собирается» там, где админ уже отменил заказ. Теперь порядок
 * шагов, подписи и допустимые переходы описаны здесь.
 *
 * Путь заказа:
 *
 *   new ──подтвердил──▶ confirmed ──оплата──▶ paid ──собрали──▶ shipped ──▶ pickup ──▶ done
 *   │                      │                  │
 *   └────── cancelled ◀────┴──────────────────┘
 *
 * - `new` — «Ожидает подтверждения»: клиент оформил, админ ещё не ответил.
 * - `confirmed` — «Ожидает оплаты»: админ подтвердил наличие и сумму.
 * - `paid` — «Ожидает отправки»: оплата получена, заказ собирается.
 * - `shipped` — «Отправлено»: передан в доставку; здесь появляется трек-номер.
 * - `pickup` — «Готов к выдаче»: лежит в ПВЗ (необязательный шаг, если заказ
 *   самовывоз или доставка в пункт выдачи).
 * - `done` — «Получено».
 * - `cancelled` — «Отменено».
 *
 * Историческое `packing` («Собирается») остаётся валидным значением: заказы,
 * созданные до этого перехода, не должны превратиться в неизвестный статус.
 */

export type DeliveryStatus =
  | "new"
  | "confirmed"
  | "paid"
  | "packing"
  | "shipped"
  | "pickup"
  | "done"
  | "cancelled";

/** Все допустимые значения колонки `orders.delivery_status`. */
export const DELIVERY_STATUSES: DeliveryStatus[] = [
  "new",
  "confirmed",
  "paid",
  "packing",
  "shipped",
  "pickup",
  "done",
  "cancelled",
];

export function isDeliveryStatus(value: string): value is DeliveryStatus {
  return (DELIVERY_STATUSES as string[]).includes(value);
}

/** Подписи для клиента: он видит не «workflow», а что происходит с его заказом. */
export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  new: "Ожидает подтверждения",
  confirmed: "Ожидает оплаты",
  paid: "Ожидает отправки",
  // `packing` — исторический статус, по смыслу то же «Ожидает отправки».
  packing: "Ожидает отправки",
  shipped: "Отправлено",
  pickup: "Готов к выдаче",
  done: "Получено",
  cancelled: "Отменено",
};

export function deliveryLabel(status: string): string {
  return isDeliveryStatus(status) ? DELIVERY_LABEL[status] : status;
}

/**
 * Шаги для прогресс-бара в кабинете. Отменённый заказ полосу не показывает.
 * `packing` свёрнут в `paid`: клиенту важно одно состояние — «Ожидает отправки».
 */
export const DELIVERY_STEPS: { key: DeliveryStatus; label: string }[] = [
  { key: "new", label: "Ожидает" },
  { key: "confirmed", label: "Подтверждён" },
  { key: "paid", label: "Оплачен" },
  { key: "shipped", label: "Отправлено" },
  { key: "done", label: "Получено" },
];

/** Позиция статуса на прогресс-баре: -1 — статус вне полосы (отменён). */
export function deliveryStepIndex(status: string): number {
  if (status === "cancelled") return -1;
  if (status === "packing") return DELIVERY_STEPS.findIndex((s) => s.key === "paid");
  // `pickup` относится к тому же шагу «Отправлено»: посылка в пути к выдаче.
  if (status === "pickup") return DELIVERY_STEPS.findIndex((s) => s.key === "shipped");
  return DELIVERY_STEPS.findIndex((s) => s.key === status);
}

/**
 * Следующий шаг для кнопки «Дальше» в панели.
 *
 * `pickup` намеренно пропущен вперёд: он нужен только для доставки в пункт
 * выдачи, поэтому не навязывается как обязательный шаг после «Отправлено».
 * Владелец всегда может поставить его вручную.
 */
export function nextDeliveryStep(current: string): DeliveryStatus | null {
  const order: DeliveryStatus[] = ["new", "confirmed", "paid", "shipped", "done"];
  if (current === "cancelled" || current === "done") return null;
  const normalized = current === "packing" ? "paid" : current === "pickup" ? "shipped" : current;
  const index = order.indexOf(normalized as DeliveryStatus);
  if (index === -1) return "confirmed";
  return order[Math.min(index + 1, order.length - 1)];
}

/** Статусы, в которых заказ ещё не завершён — для счётчиков и списков. */
export const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ["new", "confirmed", "paid", "packing", "shipped", "pickup"];

/**
 * Текст уведомления клиенту при смене статуса.
 *
 * Клиент не должен узнавать о статусе, открывая витрину: после оформления он
 * выходит из Mini App. Поэтому на каждый шаг ему приходит одно короткое
 * сообщение — что произошло и что делать дальше (оплатить, ждать, забрать).
 * Возвращает `null` для статусов, о которых писать нечего (`new` — это ответ
 * на его же заказ, уведомление было бы шумом).
 */
export function customerStatusNotice(order: {
  id: string;
  total: number;
  deliveryStatus: string;
  trackNumber?: string;
  comment?: string;
}): string | null {
  const money = `${(order.total / 100).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;
  const deadline = "Служба доставки — 3–7 дней, точный срок придёт с трек-номером.";

  switch (order.deliveryStatus) {
    case "new":
      return null;
    case "confirmed":
      return [
        `✅ Заказ №${order.id} подтверждён`,
        `Сумма к оплате: ${money}.`,
        "Напишите менеджеру в этот чат, чтобы оплатить — после оплаты заказ пойдёт в сборку.",
      ].join("\n");
    case "paid":
      return [
        `💳 Оплата по заказу №${order.id} получена`,
        `Статус: ожидает отправки. Собираем и передаём в доставку. ${deadline}`,
      ].join("\n");
    case "packing":
      return [
        `📦 Заказ №${order.id} собирается`,
        `Сумма: ${money}. Как только передадим в доставку — пришлём трек-номер.`,
      ].join("\n");
    case "shipped":
      return [
        `🚚 Заказ №${order.id} отправлен`,
        order.trackNumber ? `Трек-номер: ${order.trackNumber}` : "Трек-номер появится в кабинете.",
        deadline,
      ].join("\n");
    case "pickup":
      return [
        `📍 Заказ №${order.id} готов к выдаче`,
        order.trackNumber ? `Трек-номер: ${order.trackNumber}` : "",
        "Возьмите с собой номер заказа, он нужен на пункте выдачи.",
      ]
        .filter(Boolean)
        .join("\n");
    case "done":
      return [
        `🎉 Заказ №${order.id} получен. Спасибо за покупку!`,
        "Оставьте отзыв в карточке товара — он поможет другим покупателям.",
      ].join("\n");
    case "cancelled":
      return [
        `❌ Заказ №${order.id} отменён`,
        order.comment ? `Причина: ${order.comment}` : "",
        "Если списывались бонусы, они вернулись на счёт. Связаться с менеджером можно в этом чате.",
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return `Статус заказа №${order.id} обновлён: ${deliveryLabel(order.deliveryStatus)}.`;
  }
}

/**
 * Трек-номер имеет смысл только после отправки. Проверка нужна и в панели,
 * и в API: иначе трек можно поставить заказу, который ещё не оплачен, и
 * клиент увидит «Отправлено» с номером при статусе «Ожидает оплаты».
 */
export function trackAllowed(status: string): boolean {
  return status === "shipped" || status === "pickup" || status === "done";
}
