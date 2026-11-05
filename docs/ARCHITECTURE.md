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

- `Category` — id, name, icon (эмодзи), sortOrder, isActive → `products`
- `Product` — id, title, description, **price в копейках (Int)**, photoUrl, isActive, categoryId → `orders`
- `Order` — id, status (new/contacted/done/cancelled), comment, tgUserId, firstName, username,
  groupMessageId, productId, createdAt

## API

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/api/catalog` | публичный | категории + активные товары; на первом запросе наполняет пустую базу |
| GET | `/api/health` | публичный | проверка деплоя: диалект БД, счётчики, хранилище, бот (200/503) |
| POST | `/api/orders` | любой (initData валидируется) | создать заявку, отправить в группу; антидубль 60 с и лимит 5/мин → 429 |
| GET | `/api/admin/products` | владелец | список товаров |
| POST | `/api/admin/products` | владелец | добавить товар `{title, priceRub, description, categoryId, photoUrl}` |
| GET/POST | `/api/admin/categories` | владелец | список/создание категорий |
| GET | `/api/admin/orders` | владелец | список заявок |
| POST | `/api/admin/upload` | владелец | загрузка фото (multipart, ≤ 8 МБ, jpg/png/webp) → S3 или `public/uploads/` |
| POST | `/api/bot/webhook` | Telegram (по секрету) | админ-бот: команды, кнопки, статусы |
| GET/POST | `/api/bot/setup` | `BOT_SETUP_TOKEN` | вебхук, команды меню, диагностика (см. `docs/TELEGRAM-BOT.md`) |

## Переменные окружения (см. `.env.example`)

`DATABASE_URL`, `BOT_TOKEN`, `GROUP_CHAT_ID`, `OWNER_TELEGRAM_ID`, `WEBAPP_URL`, `ALLOW_DEV_NO_AUTH`

## Стек

- **Next.js 15 (App Router) + React 19 + TypeScript**
- **Tailwind CSS v4** (дизайн-токены в `globals.css`, см. `docs/DESIGN.md`)
- **БД:** диалект выбирается по `DATABASE_URL`: `file:` → SQLite (`better-sqlite3`), `postgres://` → PostgreSQL (`pg`).
  Единый интерфейс — `src/lib/db.ts` (`all/get/run`, плейсхолдеры `?`), доступ только через `src/lib/repo.ts`.
  Схема PG — `db-setup.sql`; проверка SQL на настоящем PG — `npm run check:pg` (pglite в WASM).
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
- **Стартовый каталог:** `src/lib/catalog-seed.ts` — 6 категорий и 17 товаров с ценами,
  описаниями и фото. `src/lib/seed.ts` заливает их идемпотентно; включается `AUTO_SEED`
  (на Vercel по умолчанию) или `npm run db:seed` локально.
- Шрифты: Unbounded + Manrope (кириллица) через `@fontsource/*`
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
