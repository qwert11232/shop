/**
 * Правила скидки — чистые функции без БД.
 *
 * Живут отдельно от `catalog.ts`, потому что его импортирует и сервер, и
 * клиент: если положить их туда, клиентский бандл тянет better-sqlite3
 * и страница падает с «Module not found: Can't resolve 'fs'».
 *
 * Модель данных: `price` — сколько платит клиент, `oldPrice` — зачёркнутая
 * цена для витрины. Корзина и заказы считаются по `price`, поэтому скидка
 * не может «потеряться» в момент оформления.
 */

/** Скидка настоящая, только если старая цена задана и выше текущей. */
export const hasDiscount = (p: { price: number; oldPrice?: number | null }): boolean =>
  Boolean(p.oldPrice && p.oldPrice > p.price);

/** Размер скидки в процентах, округлённый: 89 990 из 99 990 → 10. */
export const discountPercent = (p: { price: number; oldPrice?: number | null }): number =>
  hasDiscount(p) ? Math.round((1 - p.price / (p.oldPrice as number)) * 100) : 0;

/** Экономия в копейках — для подписи «выгода 10 000 ₽». */
export const savings = (p: { price: number; oldPrice?: number | null }): number =>
  hasDiscount(p) ? (p.oldPrice as number) - p.price : 0;
