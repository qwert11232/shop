/**
 * Стартовое наполнение каталога. Один источник правды для двух потребителей:
 * локального `npm run db:seed` и серверного bootstrap'а на продакшене
 * (первый запрос к каталогу создаёт схему и заливает данные, если база пуста).
 *
 * Цены — в рублях, в базу пишутся в копейках. Иконки не заполняются:
 * в интерфейсе их нет (см. docs/DESIGN.md), колонка осталась legacy.
 */
export type SeedCategory = { name: string };
export type SeedProduct = {
  title: string;
  category: string;
  priceRub: number;
  photo: string;
  desc: string;
};

export const SEED_CATEGORIES: SeedCategory[] = [
  { name: "Смартфоны" },
  { name: "Компьютеры" },
  { name: "Наушники" },
  { name: "Гаджеты" },
  { name: "Игровые приставки" },
  { name: "Бытовая техника" },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  { title: "iPhone 16 Pro 256 ГБ", category: "Смартфоны", priceRub: 89990, photo: "/products/iphone-16-pro.jpg", desc: "Титановый корпус, чип A18 Pro, тройная камера 48 Мп, Ceramic Shield. Гарантия 1 год." },
  { title: "Samsung Galaxy S24 Ultra 512 ГБ", category: "Смартфоны", priceRub: 94990, photo: "/products/galaxy-s24-ultra.jpg", desc: "AMOLED 6,8″ 120 Гц, Snapdragon 8 Gen 3, S Pen в комплекте, камера 200 Мп с зумом 5×." },
  { title: "MacBook Pro 14″ M4", category: "Компьютеры", priceRub: 189990, photo: "/products/macbook-pro-14.jpg", desc: "Чип Apple M4, 16 ГБ памяти, Liquid Retina XDR 120 Гц, до 18 часов автономной работы." },
  { title: "iPad Pro 13″ M4", category: "Компьютеры", priceRub: 129990, photo: "/products/ipad-pro-m4.png", desc: "OLED-дисплей Tandem, чип M4, поддержка Apple Pencil Pro. Самый тонкий корпус в линейке." },
  { title: "AirPods Pro 2", category: "Наушники", priceRub: 24990, photo: "/products/airpods-pro-2.jpg", desc: "Активное шумоподавление, чип H2, до 30 часов с кейсом, защита IP54." },
  { title: "AirPods Max", category: "Наушники", priceRub: 54990, photo: "/products/airpods-max.jpg", desc: "Накладные наушники: пространственный звук, шумоподавление, алюминиевые чашки." },
  { title: "Apple Watch Series 10", category: "Гаджеты", priceRub: 39990, photo: "/products/apple-watch-s10.jpg", desc: "Датчик температуры, быстрая зарядка, защита от воды 50 м, корпус 46 мм." },
  { title: "HomePod mini", category: "Гаджеты", priceRub: 12990, photo: "/products/homepod-mini.png", desc: "Умная колонка с Siri и объёмным звуком, управление умным домом." },
  { title: "PlayStation 5 Slim", category: "Игровые приставки", priceRub: 54990, photo: "/products/ps5.png", desc: "SSD 825 ГБ, трассировка лучей, 4K до 120 к/с. Геймпад DualSense в комплекте." },
  { title: "Геймпад DualSense для PS5", category: "Игровые приставки", priceRub: 6990, photo: "/products/dualsense.jpg", desc: "Адаптивные курки, HD-вибрация, до 10 часов автономности. Беспроводной." },
  { title: "Nintendo Switch OLED", category: "Игровые приставки", priceRub: 34990, photo: "/products/switch-oled.jpg", desc: "OLED-экран 7″, память 64 ГБ, док-станция и Joy-Con в комплекте." },
  { title: "Xbox Series X 1 ТБ", category: "Игровые приставки", priceRub: 59990, photo: "/products/xbox-series-x.jpg", desc: "12 Тфлопс, SSD 1 ТБ, 4K до 120 к/с, поддержка Game Pass." },
  { title: "Фен Dyson Supersonic", category: "Бытовая техника", priceRub: 44990, photo: "/products/dyson-supersonic.png", desc: "Умный контроль температуры, двигатель V9, 1600 Вт. Три насадки в комплекте." },
  { title: "Мультистайлер Dyson Airwrap", category: "Бытовая техника", priceRub: 54990, photo: "/products/dyson-airwrap.jpg", desc: "Сушка и укладка без экстремального нагрева, насадки Coanda." },
  { title: "Пылесос Dyson V15 Detect", category: "Бытовая техника", priceRub: 69990, photo: "/products/dyson-v15.png", desc: "Лазерная подсветка пыли, LCD-экран, до 60 минут работы." },
  { title: "Робот-пылесос Roborock S7", category: "Бытовая техника", priceRub: 49990, photo: "/products/roborock-s7.jpg", desc: "Сухая и влажная уборка, лидар-навигация, управление из приложения." },
  { title: "Электрочайник Xiaomi 1,7 л", category: "Бытовая техника", priceRub: 3990, photo: "/products/xiaomi-kettle.png", desc: "Двойные стенки, поддержание температуры до 12 часов, управление со смартфона." },
];
