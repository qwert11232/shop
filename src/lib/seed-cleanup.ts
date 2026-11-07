/**
 * Уборка демо-каталога на базе прошлого деплоя.
 *
 * Зачем: каталог живёт в коде (`catalog-seed.ts`) и сид только досоздаёт
 * недостающее — удалённый из кода товар остаётся в боевой базе навсегда.
 * Так и получилось с аксессуарами: «Чехол MagSafe» продавался с фотографией
 * iPhone, «Кабель USB-C» — с фото геймпада, «Карта памяти» — с фото Xbox,
 * «Расширенная гарантия» — с фото PlayStation. Товар с чужим фото обманывает
 * покупателя, поэтому такие позиции удаляются, а не прячутся.
 *
 * Правила, чтобы не задеть данные владельца:
 *   - удаляем только позиции по точному названию из списка `LEGACY_DEMO_TITLES`;
 *   - если у товара есть заказы — не удаляем, а скрываем (`is_active = false`):
 *     иначе история заказов потеряет фотографию и название в списках;
 *   - фото из `public/products` остаются на месте: их может использовать
 *     другой товар (так и было — обложки были общими);
 *   - удаление чистит варианты, характеристики, медиа, корзины и избранное.
 *
 * Возвращает отчёт: что удалено физически, что скрыто и по какой причине —
 * это попадает в лог, а не в угадывание.
 */

import { getDb } from "./db";

/** Названия позиций, которые ушли из каталога вместе с честными фото. */
export const LEGACY_DEMO_TITLES = [
  "Чехол силиконовый MagSafe",
  "Кабель USB-C 2 м, 100 Вт",
  "Карта памяти microSD 128 ГБ",
  "Расширенная гарантия 24 месяца",
];

export type SeedCleanupResult = {
  deleted: string[];
  hidden: string[];
};

export async function pruneLegacyDemoProducts(): Promise<SeedCleanupResult> {
  const db = await getDb();
  const result: SeedCleanupResult = { deleted: [], hidden: [] };

  for (const title of LEGACY_DEMO_TITLES) {
    const product = await db.get<{ id: string }>("SELECT id FROM products WHERE title = ?", [title]);
    if (!product) continue;

    // Заказы ссылаются на товар внешним ключом: удаление сломало бы ленту заявок
    // и список покупок клиента. Такой товар просто уходит с витрины.
    const orders = await db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM orders WHERE product_id = ?", [
      product.id,
    ]);
    if (Number(orders?.c ?? 0) > 0) {
      await db.run("UPDATE products SET is_active = ? WHERE id = ?", [false, product.id]);
      result.hidden.push(title);
      continue;
    }

    for (const table of ["cart_items", "favorites", "product_variants", "product_specs", "product_media"]) {
      await db.run(`DELETE FROM ${table} WHERE product_id = ?`, [product.id]);
    }
    // Заявки без товара быть не должно (проверили выше), но лимиты антифлуда
    // хранят пары «клиент + товар» — их тоже убираем.
    await db.run("DELETE FROM order_limits WHERE product_id = ?", [product.id]);
    await db.run("DELETE FROM products WHERE id = ?", [product.id]);
    result.deleted.push(title);
  }

  return result;
}
