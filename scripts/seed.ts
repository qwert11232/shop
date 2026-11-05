import { getDb } from "../src/lib/db";

/**
 * Сид каталога ТЕХНОЛАБ: категории + демо-товары с фото из public/products.
 * Идемпотентно: повторный запуск не создаёт дублей. Цена — в копейках.
 */
const categories = [
  { name: "Смартфоны", icon: "📱" },
  { name: "Компьютеры", icon: "💻" },
  { name: "Наушники", icon: "🎧" },
  { name: "Гаджеты", icon: "⌚" },
  { name: "Игровые приставки", icon: "🎮" },
  { name: "Бытовая техника", icon: "🏠" },
];

const products = [
  { title: "iPhone 16 Pro 256 ГБ", category: "Смартфоны", priceRub: 89990, photo: "/products/iphone-16-pro.jpg", desc: "Флагман Apple: титановый корпус, чип A18 Pro, тройная камера 48 МП, Ceramic Shield." },
  { title: "Samsung Galaxy S24 Ultra 512 ГБ", category: "Смартфоны", priceRub: 94990, photo: "/products/galaxy-s24-ultra.jpg", desc: "AMOLED 6,8\" 120 Гц, Snapdragon 8 Gen 3, S Pen, камера 200 МП с зумом 5x." },
  { title: "MacBook Pro 14\" M4", category: "Компьютеры", priceRub: 189990, photo: "/products/macbook-pro-14.jpg", desc: "Чип Apple M4, 16 ГБ unified memory, Liquid Retina XDR 120 Гц, до 18 ч работы." },
  { title: "iPad Pro 13\" M4", category: "Компьютеры", priceRub: 129990, photo: "/products/ipad-pro-m4.png", desc: "Самый тонкий iPad, OLED-дисплей Tandem, чип M4, Apple Pencil Pro." },
  { title: "AirPods Pro 2", category: "Наушники", priceRub: 24990, photo: "/products/airpods-pro-2.jpg", desc: "Активное шумоподавление, чип H2, до 30 часов с кейсом, IP54." },
  { title: "AirPods Max", category: "Наушники", priceRub: 54990, photo: "/products/airpods-max.jpg", desc: "Премиальные накладные наушники: пространственный звук, ANC." },
  { title: "Apple Watch Series 10", category: "Гаджеты", priceRub: 39990, photo: "/products/apple-watch-s10.jpg", desc: "Тонкий корпус, датчик температуры, быстрая зарядка, защита 50 м." },
  { title: "HomePod mini", category: "Гаджеты", priceRub: 12990, photo: "/products/homepod-mini.png", desc: "Умная колонка с Siri, объёмный звук 360°, умный дом." },
  { title: "PlayStation 5 Slim", category: "Игровые приставки", priceRub: 54990, photo: "/products/ps5.png", desc: "SSD 825 ГБ, трассировка лучей, 4K до 120 fps, DualSense в комплекте." },
  { title: "Геймпад DualSense для PS5", category: "Игровые приставки", priceRub: 6990, photo: "/products/dualsense.jpg", desc: "Адаптивные курки и hd-вибрация, до 10 часов автономности." },
  { title: "Nintendo Switch OLED", category: "Игровые приставки", priceRub: 34990, photo: "/products/switch-oled.jpg", desc: "OLED-экран 7\", 64 ГБ, док-станция и Joy-Con в комплекте." },
  { title: "Xbox Series X 1 ТБ", category: "Игровые приставки", priceRub: 59990, photo: "/products/xbox-series-x.jpg", desc: "12 ТФЛОПС, SSD 1 ТБ, 4K до 120 к/с, Game Pass." },
  { title: "Фен Dyson Supersonic", category: "Бытовая техника", priceRub: 44990, photo: "/products/dyson-supersonic.png", desc: "Умный контроль температуры, двигатель V9, 1600 Вт, тихий." },
  { title: "Мультистайлер Dyson Airwrap", category: "Бытовая техника", priceRub: 54990, photo: "/products/dyson-airwrap.jpg", desc: "Сушка, укладка и волны без экстремального жара — насадки Coanda." },
  { title: "Пылесос Dyson V15 Detect", category: "Бытовая техника", priceRub: 69990, photo: "/products/dyson-v15.png", desc: "Лазер подсвечивает пыль, LCD-экран, до 60 минут работы." },
  { title: "Робот-пылесос Roborock S7", category: "Бытовая техника", priceRub: 49990, photo: "/products/roborock-s7.jpg", desc: "Сухая и влажная уборка, lidar-навигация, приложение." },
  { title: "Электрочайник Xiaomi 1,7 л", category: "Бытовая техника", priceRub: 3990, photo: "/products/xiaomi-kettle.png", desc: "Двойные стенки, поддержание температуры до 12 ч, приложение." },
];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function main() {
  const db = await getDb();
  const catIds: Record<string, string> = {};

  for (const [i, c] of categories.entries()) {
    const existing = await db.get<{ id: string }>("SELECT id FROM categories WHERE name = ?", [c.name]);
    if (existing) {
      catIds[c.name] = existing.id;
      continue;
    }
    const id = uid();
    await db.run("INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)", [
      id, c.name, c.icon, i,
    ]);
    catIds[c.name] = id;
  }

  for (const p of products) {
    const exists = await db.get<{ id: string }>("SELECT id FROM products WHERE title = ?", [p.title]);
    if (exists) continue;
    await db.run(
      "INSERT INTO products (id, title, description, price, photo_url, category_id) VALUES (?, ?, ?, ?, ?, ?)",
      [uid(), p.title, p.desc, Math.round(p.priceRub * 100), p.photo, catIds[p.category]],
    );
  }

  const count = await db.get<{ c: number | string }>("SELECT COUNT(*) AS c FROM products");
  console.log(`[seed] готово (${db.dialect}): категорий=${categories.length}, товаров=${Number(count?.c ?? 0)}`);
}

main().catch((err) => {
  console.error("[seed] ошибка:", err);
  process.exit(1);
});
