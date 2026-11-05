# 🏗️ ТЕХНОЛАБ — архитектура

Telegram Mini App «витрина магазина техники». Владелец публикует товары, покупатели
оформляют заявку — заявка улетает сообщением в группу Telegram.

## Компоненты

```
┌────────────────┐     initData (HMAC)      ┌──────────────────────────────┐
│  Telegram Bot  │◄────────────────────────►│  Next.js App (Vercel/хостинг)│
│  (@BotFather)  │   открывает Mini App     │  ├─ /            витрина (каталог)
│  + группа      │◄── sendMessage (заявка)─│  ├─ /admin       панель владельца
└────────────────┘                          │  └─ /api/*       REST          │
                                            │       ├─ catalog   GET  (публичный)
                                            │       ├─ orders    POST (создание заявки)
                                            │       └─ admin/*   GET/POST (владелец)
                                            └──────────┬───────────────────────┘
                                                       │ SQL (src/lib/repo.ts)
                                            ┌──────────▼───────────┐
                                            │  База данных         │
                                            │  dev: SQLite         │
                                            │  prod: PostgreSQL    │
                                            │  (Neon/Supabase)     │
                                            └──────────────────────┘
```

## Поток заявки (главный сценарий)

1. Пользователь открывает Mini App из меню бота/группы → фронтенд читает
   `window.Telegram.WebApp.initData`.
2. Выбирает товар → «Оформить заказ» → `POST /api/orders { initData, productId, comment }`.
3. Сервер валидирует initData (HMAC-SHA256, secret = `HMAC("WebAppData", BOT_TOKEN)`),
   извлекает пользователя Telegram.
4. Создаёт запись `Order` в БД.
5. Формирует текст и отправляет в группу: `POST https://api.telegram.org/bot<TOKEN>/sendMessage`
   с `chat_id = GROUP_CHAT_ID`. Пример сообщения:

   ```
   🛒 Новая заявка — ТЕХНОЛАБ

   📦 Позиция: iPhone 16 Pro 256 ГБ
   💰 Цена: 89 990 ₽
   👤 Заинтересовалась/лся: Иван @ivan
   💬 Комментарий: хочу забрать завтра
   🕐 04.11.2026, 18:30
   ```

6. Клиенту возвращается `{ ok, message, sentToGroup }` — видит подтверждение и текст заявки.

## Поток публикации товара (владелец)

1. `/admin` → `POST /api/admin/categories|products|upload` с заголовком `x-telegram-init-data`.
2. Сервер сверяет `user.id === OWNER_TELEGRAM_ID` (после валидации HMAC).
3. Фото загружается multipart-формой: в S3/R2/MinIO при заданном `S3_BUCKET`, иначе локально
   в `public/uploads/`. На Vercel локальная запись недоступна — без S3 `/api/admin/upload` вернёт 501.

## Модель данных (SQLite локально — `src/lib/db.ts`; PostgreSQL прод — `db-setup.sql`)

Витрина (v0004, 14 таблиц):

- `Category` — id, name, icon, sortOrder, isActive → `products`
- `Product` — id, title, description, **price в копейках**, photoUrl, brand, isActive, categoryId
- `ProductVariant` — id, productId, label, kind (color/storage/config/size), **extra в копейках**
  (может быть отрицательной: младшая память дешевле)
- `ProductSpec` — productId, groupName, name, value, unit, numeric, sortOrder;
  в той же таблице живут связи cross-sell (`group_name = 'cross-sell'`)
- `ProductMedia` — productId, kind (image/video), url, sortOrder → галерея карточки
- `Review` — id, productId, tgUserId, author, rating 1–5, text, createdAt
- `Favorite` — tgUserId + productId (переключатель)
- `CartItem` — tgUserId, productId, variantId, quantity 1–99
- `Customer` — tgUserId, firstName, username, phone, bonusBalance, referralCode, referredBy
- `BonusEvent` — amount (±), reason, orderId, createdAt — журнал, из него выводится баланс
- `Order` — id, status (new/contacted/done/cancelled), comment, tgUserId, firstName, username,
  groupMessageId, productId, createdAt + доставка: deliveryStatus (new/packing/shipped/pickup/done/cancelled),
  trackNumber, total, bonusUsed, bonusEarned, contactName, contactPhone
- `OrderItem` — orderId, productId, variantId, title, variant, price, quantity
- `OrderEvent` — orderId, status, actor (admin/client), createdAt — история переходов

Итого цена позиции = `products.price + product_variants.extra`; всё в копейках.

## API

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/api/catalog` | публичный | категории + активные товары; `?flat=1` — плоский список с фильтрами, брендами и фасетами |
| GET | `/api/catalog/[id]` | публичный | карточка: варианты, характеристики, галерея, отзывы, cross-sell, признак избранного |
| GET | `/api/health` | публичный | проверка деплоя: диалект БД, счётчики, хранилище, бот (200/503) |
| POST | `/api/orders` | любой (initData валидируется) | создать заявку, отправить в группу; антидубль 60 с и лимит 5/мин → 429 |
| GET | `/api/admin/products` | владелец | список товаров |
| POST | `/api/admin/products` | владелец | добавить товар `{title, priceRub, description, categoryId, photoUrl}` |
| GET/POST | `/api/admin/categories` | владелец | список/создание категорий |
| GET | `/api/admin/orders` | владелец | список заявок |
| POST | `/api/admin/upload` | владелец | загрузка фото (multipart, ≤ 8 МБ, jpg/png/webp) → S3 или `public/uploads/` |
| POST | `/api/bot/webhook` | Telegram (по секрету) | админ-бот: команды, кнопки, статусы |
| GET/POST | `/api/bot/setup` | `BOT_SETUP_TOKEN` | вебхук, команды меню, диагностика (см. `docs/TELEGRAM-BOT.md`) |
| GET/POST | `/api/cart` | initData | корзина; `POST {action: add/set/remove}` возвращает пересчитанную корзину |
| POST | `/api/checkout` | initData | оформление из корзины: цены и бонусы считает сервер, заказ уходит в группу |
| GET/POST | `/api/favorites` | initData | избранное: список и переключатель |
| GET | `/api/compare?ids=` | публичный | сравнение 2–3 товаров по общим характеристикам |
| GET/POST | `/api/me` | initData | профиль, бонусы, реферальный код; телефон и ввод кода друга |
| GET | `/api/me/orders` | initData | история заказов со статусами доставки и треками |
| GET/POST | `/api/reviews` | GET публичный, POST initData | отзывы; написать можно только после заказа `done` |

## Переменные окружения (см. `.env.example`)

`DATABASE_URL`, `BOT_TOKEN`, `BOT_WEBHOOK_SECRET`, `BOT_SETUP_TOKEN`, `ADMIN_TELEGRAM_IDS`,
`ADMIN_TELEGRAM_USERNAMES`, `GROUP_CHAT_ID`, `WEBAPP_URL`, `AUTO_SEED`, `S3_*`, `ALLOW_DEV_NO_AUTH`

`AUTO_SEED` включён по умолчанию: сид идемпотентный, достраивает у существующих
товаров бренды, варианты и характеристики (нужно после обновления схемы), а `AUTO_SEED=0`
выключает его, когда каталог ведётся только через `/admin`.

## Стек

- **Next.js 15 (App Router) + React 19 + TypeScript**
- **Tailwind CSS v4** (дизайн-токены в `globals.css`, см. `docs/DESIGN.md`)
- **БД:** диалект выбирается по `DATABASE_URL`: `file:` → SQLite (`better-sqlite3`), `postgres://` → PostgreSQL (`pg`).
  Единый интерфейс — `src/lib/db.ts` (`all/get/run`, плейсхолдеры `?`), доступ к данным —
  `src/lib/repo.ts` (владелец, каталог), `src/lib/catalog.ts` (витрина, фильтры, сравнение, избранное),
  `src/lib/shop.ts` (профиль, бонусы, корзина, заказы, доставка), `src/lib/reviews.ts`.
  Схема PG — `db-setup.sql`; проверка SQL на настоящем PG — `npm run check:pg` (pglite в WASM).
- **Проверки:** `npm run check` = lint + typecheck + `check:storage` + `check:pg` + `check:bot` + `check:shop`
  (витрина: фильтры, корзина, заказ, бонусы, отзывы, сравнение — на настоящей SQLite-базе).
- **Фото:** `src/lib/storage.ts` — S3-совместимое хранилище (`S3_*`) или локальный `public/uploads/`;
  на Vercel без S3 загрузка отвечает 501 вместо тихой потери файла.
- **Лимиты заявок:** таблица `order_limits` в БД — общая для всех инстансов и переживает рестарт.
- **Админ-бот:** вебхук `src/app/api/bot/webhook/route.ts`, экраны — `src/lib/bot-screens.ts`
  (чистые функции, проверяются без сети), доступ — `src/lib/bot-access.ts`, клиент Bot API —
  `src/lib/bot-api.ts`. Состояние диалога — таблица `bot_state` (одноразовая, TTL 15 минут).
  Подробно: `docs/TELEGRAM-BOT.md`.
- **Схема на деплое:** `src/lib/db-postgres-schema.ts` применяет тот же DDL, что `db-setup.sql`,
  при первом подключении (идемпотентно). На Neon/Supabase нет CLI миграций, поэтому без этого
  каталог отвечал бы 500 «relation does not exist».
- **Стартовый каталог:** `src/lib/catalog-seed.ts` — 6 категорий, 17 товаров и 4 аксессуара
  с ценами, брендами, характеристиками, вариантами и связями «с этим покупают».
  `src/lib/seed.ts` заливает их идемпотентно и достраивает недостающее у товаров,
  созданных прошлым деплоем; включается по умолчанию, `AUTO_SEED=0` отключает.
- Шрифты: Manrope (кириллица) через `@fontsource/*`
- Без сторонних UI-библиотек; нативный Telegram WebApp SDK подключается скриптом

## Деплой

1. БД: создать проект на Neon/Supabase → вставить `db-setup.sql` в SQL-редактор →
   `DATABASE_URL=postgresql://…?sslmode=require`. Слой данных переключится на PG автоматически.
   Локально оставьте `file:./dev.db` — схема SQLite создаётся сама.
2. Приложение: Vercel (или любой Node-хостинг) → `npm run build && npm start`.
3. В `.env` продакшена: `BOT_TOKEN`, `GROUP_CHAT_ID`, `OWNER_TELEGRAM_ID`, `WEBAPP_URL=https://<домен>`, `ALLOW_DEV_NO_AUTH` — **выключить**.
4. В @BotFather: `/setmenubutton` или кнопка WebApp в группе → URL = `WEBAPP_URL`.
5. Готово: участники группы открывают приложение и оставляют заявки.

## Диагностика деплоя

Откройте `https://<домен>/api/health`:

```json
{ "ok": true, "dialect": "postgres", "counts": { "categories": 6, "products": 17 },
  "checks": { "db": "postgres", "autoSeed": "1 (по умолчанию)", "storage": "s3",
              "telegram": true, "owner": true } }
```

`ok: false` + `503` — база подключена, но каталог пуст (автонаполнение выключено).
`500` с `error` — база недоступна: проверьте `DATABASE_URL` и `sslmode=require`.

## Локальный запуск

```bash
cp .env.example .env        # заполнить OWNER_TELEGRAM_ID для dev-админки
npm install

npm run db:seed             # категории + демо-товары
npm run dev                 # http://localhost:3000

npm run check               # lint + typecheck + проверки хранилища и SQL для PG
```
