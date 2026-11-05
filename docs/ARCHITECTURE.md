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
3. Фото загружается multipart-формой в `public/uploads/` — это работает только локально:
   на Vercel ФС доступна лишь на чтение, нужен объектный стор (S3/R2/Vercel Blob).

## Модель данных (SQLite локально — `src/lib/db.ts`; PostgreSQL прод — `db-setup.sql`)

- `Category` — id, name, icon (эмодзи), sortOrder, isActive → `products`
- `Product` — id, title, description, **price в копейках (Int)**, photoUrl, isActive, categoryId → `orders`
- `Order` — id, status (new/contacted/done/cancelled), comment, tgUserId, firstName, username,
  groupMessageId, productId, createdAt

## API

| Метод | Путь | Доступ | Назначение |
| --- | --- | --- | --- |
| GET | `/api/catalog` | публичный | категории + активные товары |
| POST | `/api/orders` | любой (initData валидируется) | создать заявку, отправить в группу; антидубль 60 с и лимит 5/мин → 429 |
| GET | `/api/admin/products` | владелец | список товаров |
| POST | `/api/admin/products` | владелец | добавить товар `{title, priceRub, description, categoryId, photoUrl}` |
| GET/POST | `/api/admin/categories` | владелец | список/создание категорий |
| GET | `/api/admin/orders` | владелец | список заявок |
| POST | `/api/admin/upload` | владелец | загрузка фото (multipart, ≤ 8 МБ, jpg/png/webp) |

## Переменные окружения (см. `.env.example`)

`DATABASE_URL`, `BOT_TOKEN`, `GROUP_CHAT_ID`, `OWNER_TELEGRAM_ID`, `WEBAPP_URL`, `ALLOW_DEV_NO_AUTH`

## Стек

- **Next.js 15 (App Router) + React 19 + TypeScript**
- **Tailwind CSS v4** (дизайн-токены в `globals.css`, см. `docs/DESIGN.md`)
- **БД:** dev — SQLite через `better-sqlite3`, prod — PostgreSQL по `db-setup.sql`; доступ через тонкий репозиторий `src/lib/repo.ts`
- Шрифты: Unbounded + Manrope (кириллица) через `@fontsource/*`
- Без сторонних UI-библиотек; нативный Telegram WebApp SDK подключается скриптом

## Деплой

1. БД: создать проект на Neon/Supabase → вставить `db-setup.sql` в SQL-редактор. Слой данных
   (`src/lib/db.ts`) пока только SQLite: для прода нужен PG-адаптер с тем же API, что у
   `better-sqlite3` (`prepare/get/all/run`), иначе приложение стартует на файле.
2. Приложение: Vercel (или любой Node-хостинг) → `npm run build && npm start`.
3. В `.env` продакшена: `BOT_TOKEN`, `GROUP_CHAT_ID`, `OWNER_TELEGRAM_ID`, `WEBAPP_URL=https://<домен>`, `ALLOW_DEV_NO_AUTH` — **выключить**.
4. В @BotFather: `/setmenubutton` или кнопка WebApp в группе → URL = `WEBAPP_URL`.
5. Готово: участники группы открывают приложение и оставляют заявки.

## Локальный запуск

```bash
cp .env.example .env        # заполнить OWNER_TELEGRAM_ID для dev-админки
npm install

npm run db:seed             # категории + демо-товары
npm run dev                 # http://localhost:3000
```
