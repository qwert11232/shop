import { seedCatalog } from "../src/lib/seed";
import { databaseUrl, isPostgresUrl } from "../src/lib/db";

/**
 * Сид каталога ТЕХНОЛАБ: категории + товары с фото из public/products.
 * Данные — src/lib/catalog-seed.ts (тот же набор, что заливается на деплое).
 * Идемпотентно: повторный запуск не создаёт дублей.
 */
async function main() {
  const url = databaseUrl();
  const target = isPostgresUrl(url) ? "PostgreSQL" : `SQLite (${url})`;
  console.log(`[seed] цель: ${target}`);

  const result = await seedCatalog();
  console.log(
    `[seed] готово (${result.driver}): добавлено категорий ${result.categories}, товаров ${result.products}`,
  );
}

main().catch((err) => {
  console.error("[seed] ошибка:", err);
  process.exit(1);
});
