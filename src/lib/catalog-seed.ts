/**
 * Стартовое наполнение каталога ТЕХНОЛАБ. Один источник правды для локального
 * `npm run db:seed` и серверного bootstrap'а на деплое (первый запрос к каталогу
 * создаёт схему и заливает данные, если база пуста).
 *
 * Технику выбирают по характеристикам, поэтому у товара есть бренд, спецификации
 * (по ним работают фильтры и сравнение) и варианты, меняющие цену.
 * Цены — в рублях, в базу пишутся в копейках.
 */
export type SeedCategory = { name: string };

export type SeedVariant = {
  label: string;
  /** kind: color — цвет, storage — память, config — комплектация, size — размер. */
  kind: "color" | "storage" | "config" | "size";
  /** Надбавка к базовой цене в рублях (может быть отрицательной). */
  extraRub?: number;
};

export type SeedSpec = {
  group: string;
  name: string;
  value: string;
  /** Единица измерения отдельно от значения: «256» + «ГБ» — так сравнивать проще. */
  unit?: string;
  /** Число для сортировки и сравнения (память в ГБ, диагональ в дюймах и т.п.). */
  numeric?: number;
};

export type SeedProduct = {
  title: string;
  category: string;
  brand: string;
  priceRub: number;
  photo: string;
  desc: string;
  /** Дополнительные кадры галереи (первый — основной photo). */
  gallery?: string[];
  specs?: SeedSpec[];
  variants?: SeedVariant[];
  /** Аксессуары, которые покупают с этим товаром (заголовки из этого же файла). */
  crossSell?: string[];
};

export const SEED_CATEGORIES: SeedCategory[] = [
  { name: "Смартфоны" },
  { name: "Компьютеры" },
  { name: "Наушники" },
  { name: "Гаджеты" },
  { name: "Игровые приставки" },
  { name: "Бытовая техника" },
];

/** Аксессуары: продаются как отдельные товары и предлагаются в блоке cross-sell. */
const ACCESSORIES: SeedProduct[] = [
  {
    title: "Чехол силиконовый MagSafe",
    category: "Гаджеты",
    brand: "Apple",
    priceRub: 4990,
    photo: "/products/iphone-16-pro.jpg",
    desc: "Мягкий силикон, магнитное кольцо MagSafe, точные вырезы под камеру и порт.",
    specs: [
      { group: "Совместимость", name: "Модели", value: "iPhone 16 / 16 Pro" },
      { group: "Материал", name: "Покрытие", value: "силикон, микрофибра" },
    ],
  },
  {
    title: "Кабель USB-C 2 м, 100 Вт",
    category: "Гаджеты",
    brand: "Технолаб",
    priceRub: 1490,
    photo: "/products/dualsense.jpg",
    desc: "Оплётка из нейлона, зарядка до 100 Вт и передача данных 480 Мбит/с.",
    specs: [
      { group: "Питание", name: "Мощность", value: "100", unit: "Вт", numeric: 100 },
      { group: "Длина", name: "Длина", value: "2", unit: "м", numeric: 2 },
    ],
  },
  {
    title: "Карта памяти microSD 128 ГБ",
    category: "Гаджеты",
    brand: "SanDisk",
    priceRub: 2190,
    photo: "/products/xbox-series-x.jpg",
    desc: "Класс U3, V30: подходит для 4K-видео в камерах, дронах и приставках.",
    specs: [
      { group: "Объём", name: "Память", value: "128", unit: "ГБ", numeric: 128 },
      { group: "Скорость", name: "Запись", value: "90", unit: "МБ/с", numeric: 90 },
    ],
  },
  {
    title: "Расширенная гарантия 24 месяца",
    category: "Гаджеты",
    brand: "Технолаб",
    priceRub: 3990,
    photo: "/products/ps5.png",
    desc: "Продлевает заводскую гарантию до двух лет: ремонт или замена без справок.",
    specs: [{ group: "Условия", name: "Срок", value: "24", unit: "мес", numeric: 24 }],
  },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    title: "iPhone 16 Pro 256 ГБ",
    category: "Смартфоны",
    brand: "Apple",
    priceRub: 89990,
    photo: "/products/iphone-16-pro.jpg",
    desc: "Титановый корпус, чип A18 Pro, тройная камера 48 Мп, Ceramic Shield.",
    specs: [
      { group: "Экран", name: "Диагональ", value: "6,3", unit: "″", numeric: 6.3 },
      { group: "Экран", name: "Частота", value: "120", unit: "Гц", numeric: 120 },
      { group: "Память", name: "Встроенная память", value: "256", unit: "ГБ", numeric: 256 },
      { group: "Память", name: "Оперативная память", value: "8", unit: "ГБ", numeric: 8 },
      { group: "Камера", name: "Основная", value: "48", unit: "Мп", numeric: 48 },
      { group: "Питание", name: "Автономность", value: "до 27", unit: "ч", numeric: 27 },
      { group: "Корпус", name: "Материал", value: "титан" },
      { group: "Корпус", name: "Защита", value: "IP68" },
    ],
    variants: [
      { label: "Чёрный титан", kind: "color" },
      { label: "Белый титан", kind: "color" },
      { label: "Натуральный титан", kind: "color" },
      { label: "128 ГБ", kind: "storage", extraRub: -8000 },
      { label: "256 ГБ", kind: "storage" },
      { label: "512 ГБ", kind: "storage", extraRub: 15000 },
    ],
    crossSell: ["Чехол силиконовый MagSafe", "Кабель USB-C 2 м, 100 Вт", "Расширенная гарантия 24 месяца"],
  },
  {
    title: "Samsung Galaxy S24 Ultra 512 ГБ",
    category: "Смартфоны",
    brand: "Samsung",
    priceRub: 94990,
    photo: "/products/galaxy-s24-ultra.jpg",
    desc: "AMOLED 6,8″ 120 Гц, Snapdragon 8 Gen 3, S Pen в комплекте, камера 200 Мп.",
    specs: [
      { group: "Экран", name: "Диагональ", value: "6,8", unit: "″", numeric: 6.8 },
      { group: "Экран", name: "Частота", value: "120", unit: "Гц", numeric: 120 },
      { group: "Память", name: "Встроенная память", value: "512", unit: "ГБ", numeric: 512 },
      { group: "Память", name: "Оперативная память", value: "12", unit: "ГБ", numeric: 12 },
      { group: "Камера", name: "Основная", value: "200", unit: "Мп", numeric: 200 },
      { group: "Корпус", name: "Защита", value: "IP68" },
    ],
    variants: [
      { label: "Титановый серый", kind: "color" },
      { label: "Титановый фиолетовый", kind: "color" },
      { label: "256 ГБ", kind: "storage", extraRub: -7000 },
      { label: "512 ГБ", kind: "storage" },
    ],
    crossSell: ["Кабель USB-C 2 м, 100 Вт", "Расширенная гарантия 24 месяца"],
  },
  {
    title: "MacBook Pro 14″ M4",
    category: "Компьютеры",
    brand: "Apple",
    priceRub: 189990,
    photo: "/products/macbook-pro-14.jpg",
    desc: "Чип Apple M4, 16 ГБ памяти, Liquid Retina XDR 120 Гц, до 18 часов работы.",
    specs: [
      { group: "Экран", name: "Диагональ", value: "14,2", unit: "″", numeric: 14.2 },
      { group: "Экран", name: "Тип матрицы", value: "Liquid Retina XDR" },
      { group: "Память", name: "Оперативная память", value: "16", unit: "ГБ", numeric: 16 },
      { group: "Память", name: "SSD", value: "512", unit: "ГБ", numeric: 512 },
      { group: "Питание", name: "Автономность", value: "до 18", unit: "ч", numeric: 18 },
      { group: "Процессор", name: "Чип", value: "Apple M4" },
    ],
    variants: [
      { label: "16 ГБ / 512 ГБ", kind: "config" },
      { label: "24 ГБ / 1 ТБ", kind: "config", extraRub: 30000 },
      { label: "Серебристый", kind: "color" },
      { label: "Космический чёрный", kind: "color" },
    ],
    crossSell: ["Кабель USB-C 2 м, 100 Вт", "Расширенная гарантия 24 месяца"],
  },
  {
    title: "iPad Pro 13″ M4",
    category: "Компьютеры",
    brand: "Apple",
    priceRub: 129990,
    photo: "/products/ipad-pro-m4.png",
    desc: "OLED-дисплей Tandem, чип M4, поддержка Apple Pencil Pro.",
    specs: [
      { group: "Экран", name: "Диагональ", value: "13", unit: "″", numeric: 13 },
      { group: "Память", name: "Встроенная память", value: "256", unit: "ГБ", numeric: 256 },
      { group: "Процессор", name: "Чип", value: "Apple M4" },
      { group: "Корпус", name: "Толщина", value: "5,1", unit: "мм", numeric: 5.1 },
    ],
    variants: [
      { label: "256 ГБ", kind: "storage" },
      { label: "512 ГБ", kind: "storage", extraRub: 18000 },
      { label: "Только Wi-Fi", kind: "config" },
      { label: "Wi-Fi + Cellular", kind: "config", extraRub: 12000 },
    ],
    crossSell: ["Кабель USB-C 2 м, 100 Вт", "Расширенная гарантия 24 месяца"],
  },
  {
    title: "AirPods Pro 2",
    category: "Наушники",
    brand: "Apple",
    priceRub: 24990,
    photo: "/products/airpods-pro-2.jpg",
    desc: "Активное шумоподавление, чип H2, до 30 часов с кейсом, защита IP54.",
    specs: [
      { group: "Звук", name: "Шумоподавление", value: "активное" },
      { group: "Питание", name: "Автономность", value: "до 30", unit: "ч", numeric: 30 },
      { group: "Корпус", name: "Защита", value: "IP54" },
    ],
    variants: [{ label: "Белый", kind: "color" }],
    crossSell: ["Кабель USB-C 2 м, 100 Вт", "Расширенная гарантия 24 месяца"],
  },
  {
    title: "AirPods Max",
    category: "Наушники",
    brand: "Apple",
    priceRub: 54990,
    photo: "/products/airpods-max.jpg",
    desc: "Накладные наушники: пространственный звук, шумоподавление, алюминиевые чашки.",
    specs: [
      { group: "Звук", name: "Пространственный звук", value: "есть" },
      { group: "Питание", name: "Автономность", value: "до 20", unit: "ч", numeric: 20 },
    ],
    variants: [
      { label: "Серый космос", kind: "color" },
      { label: "Серебристый", kind: "color" },
    ],
  },
  {
    title: "Apple Watch Series 10",
    category: "Гаджеты",
    brand: "Apple",
    priceRub: 39990,
    photo: "/products/apple-watch-s10.jpg",
    desc: "Датчик температуры, быстрая зарядка, защита от воды 50 м.",
    specs: [
      { group: "Корпус", name: "Размер", value: "46", unit: "мм", numeric: 46 },
      { group: "Корпус", name: "Защита от воды", value: "50", unit: "м", numeric: 50 },
      { group: "Датчики", name: "Температура", value: "есть" },
    ],
    variants: [
      { label: "42 мм", kind: "size", extraRub: -3000 },
      { label: "46 мм", kind: "size" },
      { label: "Чёрный", kind: "color" },
    ],
  },
  {
    title: "HomePod mini",
    category: "Гаджеты",
    brand: "Apple",
    priceRub: 12990,
    photo: "/products/homepod-mini.png",
    desc: "Умная колонка с Siri и объёмным звуком, управление умным домом.",
    specs: [
      { group: "Звук", name: "Объёмный звук", value: "360°" },
      { group: "Связь", name: "Протоколы", value: "Wi-Fi 4, Bluetooth 5.0" },
    ],
    variants: [
      { label: "Белый", kind: "color" },
      { label: "Тёмно-синий", kind: "color" },
    ],
  },
  {
    title: "PlayStation 5 Slim",
    category: "Игровые приставки",
    brand: "Sony",
    priceRub: 54990,
    photo: "/products/ps5.png",
    desc: "SSD 825 ГБ, трассировка лучей, 4K до 120 к/с. Геймпад DualSense в комплекте.",
    specs: [
      { group: "Память", name: "SSD", value: "825", unit: "ГБ", numeric: 825 },
      { group: "Видео", name: "Максимальное разрешение", value: "4K 120 fps" },
      { group: "Комплект", name: "Геймпад", value: "DualSense" },
    ],
    variants: [
      { label: "С дисководом", kind: "config" },
      { label: "Цифровая версия", kind: "config", extraRub: -5000 },
    ],
    crossSell: ["Геймпад DualSense для PS5", "Карта памяти microSD 128 ГБ", "Расширенная гарантия 24 месяца"],
  },
  {
    title: "Геймпад DualSense для PS5",
    category: "Игровые приставки",
    brand: "Sony",
    priceRub: 6990,
    photo: "/products/dualsense.jpg",
    desc: "Адаптивные курки, HD-вибрация, до 10 часов автономности.",
    specs: [
      { group: "Питание", name: "Автономность", value: "до 10", unit: "ч", numeric: 10 },
      { group: "Связь", name: "Подключение", value: "Bluetooth / USB-C" },
    ],
    variants: [
      { label: "Белый", kind: "color" },
      { label: "Чёрный", kind: "color" },
    ],
  },
  {
    title: "Nintendo Switch OLED",
    category: "Игровые приставки",
    brand: "Nintendo",
    priceRub: 34990,
    photo: "/products/switch-oled.jpg",
    desc: "OLED-экран 7″, память 64 ГБ, док-станция и Joy-Con в комплекте.",
    specs: [
      { group: "Экран", name: "Диагональ", value: "7", unit: "″", numeric: 7 },
      { group: "Память", name: "Встроенная память", value: "64", unit: "ГБ", numeric: 64 },
    ],
    variants: [
      { label: "Белый", kind: "color" },
      { label: "Неон", kind: "color" },
    ],
    crossSell: ["Карта памяти microSD 128 ГБ", "Расширенная гарантия 24 месяца"],
  },
  {
    title: "Xbox Series X 1 ТБ",
    category: "Игровые приставки",
    brand: "Microsoft",
    priceRub: 59990,
    photo: "/products/xbox-series-x.jpg",
    desc: "12 Тфлопс, SSD 1 ТБ, 4K до 120 к/с, поддержка Game Pass.",
    specs: [
      { group: "Память", name: "SSD", value: "1024", unit: "ГБ", numeric: 1024 },
      { group: "Видео", name: "Производительность", value: "12", unit: "Тфлопс", numeric: 12 },
    ],
    variants: [{ label: "Стандарт", kind: "config" }],
    crossSell: ["Расширенная гарантия 24 месяца"],
  },
  {
    title: "Фен Dyson Supersonic",
    category: "Бытовая техника",
    brand: "Dyson",
    priceRub: 44990,
    photo: "/products/dyson-supersonic.png",
    desc: "Умный контроль температуры, двигатель V9, 1600 Вт. Три насадки в комплекте.",
    specs: [
      { group: "Питание", name: "Мощность", value: "1600", unit: "Вт", numeric: 1600 },
      { group: "Комплект", name: "Насадки", value: "3", unit: "шт.", numeric: 3 },
    ],
    variants: [
      { label: "Медь", kind: "color" },
      { label: "Чёрный никель", kind: "color" },
    ],
  },
  {
    title: "Мультистайлер Dyson Airwrap",
    category: "Бытовая техника",
    brand: "Dyson",
    priceRub: 54990,
    photo: "/products/dyson-airwrap.jpg",
    desc: "Сушка и укладка без экстремального нагрева, насадки Coanda.",
    specs: [
      { group: "Питание", name: "Мощность", value: "1300", unit: "Вт", numeric: 1300 },
      { group: "Комплект", name: "Насадки", value: "6", unit: "шт.", numeric: 6 },
    ],
    variants: [{ label: "Никель / медь", kind: "color" }],
  },
  {
    title: "Пылесос Dyson V15 Detect",
    category: "Бытовая техника",
    brand: "Dyson",
    priceRub: 69990,
    photo: "/products/dyson-v15.png",
    desc: "Лазерная подсветка пыли, LCD-экран, до 60 минут работы.",
    specs: [
      { group: "Питание", name: "Мощность всасывания", value: "240", unit: "аВт", numeric: 240 },
      { group: "Питание", name: "Автономность", value: "до 60", unit: "мин", numeric: 60 },
      { group: "Корпус", name: "Тип", value: "вертикальный" },
    ],
    variants: [{ label: "Стандарт", kind: "config" }],
  },
  {
    title: "Робот-пылесос Roborock S7",
    category: "Бытовая техника",
    brand: "Roborock",
    priceRub: 49990,
    photo: "/products/roborock-s7.jpg",
    desc: "Сухая и влажная уборка, лидар-навигация, управление из приложения.",
    specs: [
      { group: "Питание", name: "Разрежение", value: "2500", unit: "Па", numeric: 2500 },
      { group: "Уборка", name: "Влажная уборка", value: "есть" },
      { group: "Навигация", name: "Тип", value: "лидар" },
    ],
    variants: [{ label: "Белый", kind: "color" }],
  },
  {
    title: "Электрочайник Xiaomi 1,7 л",
    category: "Бытовая техника",
    brand: "Xiaomi",
    priceRub: 3990,
    photo: "/products/xiaomi-kettle.png",
    desc: "Двойные стенки, поддержание температуры до 12 часов.",
    specs: [
      { group: "Питание", name: "Мощность", value: "1800", unit: "Вт", numeric: 1800 },
      { group: "Объём", name: "Объём", value: "1,7", unit: "л", numeric: 1.7 },
    ],
    variants: [{ label: "Белый", kind: "color" }],
  },
  ...ACCESSORIES,
];
