/**
 * Разбор и проверка строки подключения к базе.
 *
 * Зачем отдельный модуль: строка `DATABASE_URL` — самая частая причина «на деплое
 * пусто». Neon/Supabase дают длинный URL, который легко скопировать не полностью
 * (например, без хоста, с экранированным паролем или с `&amp;` из HTML).
 * Вместо загадочного `ENOTFOUND neondb_owner` лучше сказать, что именно не так.
 *
 * Функция чистая: разбирает строку и возвращает найденные проблемы. Пароль
 * наружу не отдаётся никогда — только его наличие.
 */

export type Dialect = "sqlite" | "postgres";

export type DbUrlReport = {
  dialect: Dialect;
  /** Хост без порта — безопасно показывать в диагностике. */
  host: string;
  port: string;
  database: string;
  user: string;
  hasPassword: boolean;
  problems: string[];
  warnings: string[];
};

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

export function dialectOf(url: string): Dialect {
  return /^postgres(ql)?:\/\//i.test(url.trim()) ? "postgres" : "sqlite";
}

/** `&amp;` из HTML/чата ломает параметры — тихая, но частая ошибка при копировании. */
function normalizeRaw(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/&amp;/g, "&");
}

export function analyzeDatabaseUrl(raw: string): DbUrlReport {
  const value = normalizeRaw(raw ?? "");
  const report: DbUrlReport = {
    dialect: dialectOf(value),
    host: "",
    port: "",
    database: "",
    user: "",
    hasPassword: false,
    problems: [],
    warnings: [],
  };

  if (report.dialect === "sqlite") {
    if (!value) report.problems.push("DATABASE_URL не задан — используется file:./dev.db");
    return report;
  }

  // Пароль с неэкранированными «@», «/» или «#» рвёт разбор URL: считаем «@» до хоста.
  const afterScheme = value.replace(/^postgres(ql)?:\/\//i, "");
  const atCount = (afterScheme.match(/@/g) ?? []).length;
  if (atCount === 0) {
    report.problems.push("в строке нет «@» — не указан хост базы (выглядит как «postgresql://пользователь:пароль@хост/база»)");
  } else if (atCount > 1) {
    report.warnings.push("в строке несколько «@» — скорее всего, в пароле есть неэкранированные символы (@ → %40)");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (err) {
    report.problems.push(`строку не удалось разобрать как URL: ${err instanceof Error ? err.message : "ошибка"}`);
    return report;
  }

  report.user = decodeURIComponent(parsed.username || "");
  report.hasPassword = Boolean(parsed.password);
  report.host = parsed.hostname;
  report.port = parsed.port;
  report.database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  if (atCount > 0) {
    // Без точки в хосте — почти всегда чужое слово вместо хоста: «neondb_owner», «neondb».
    if (!report.host) {
      report.problems.push("не удалось определить хост базы");
    } else if (!localHosts.has(report.host) && !report.host.includes(".")) {
      report.problems.push(
        `в строке нет хоста: «${report.host}» похоже на имя пользователя или базы. Нужен адрес вида ep-xxx.eu-central-1.aws.neon.tech`,
      );
    }
    if (!report.hasPassword) {
      report.problems.push("в строке нет пароля — после пользователя должно быть «:пароль@хост»");
    }
    if (!report.database || report.database.includes("//")) {
      report.problems.push("не удалось определить имя базы в конце строки (должно быть «/neondb»)");
    }
  }

  const ssl = parsed.searchParams.get("sslmode");
  if (!localHosts.has(report.host) && !ssl) {
    report.warnings.push("нет параметра ?sslmode=require — Neon и Supabase требуют SSL");
  }
  if (/neon\.tech$/i.test(report.host) && !report.host.includes("-pooler")) {
    report.warnings.push(
      "это прямое подключение Neon; на Vercel (много коротких запросов) лучше адрес с «-pooler», чтобы не упереться в лимит соединений",
    );
  }
  return report;
}

/**
 * Строка для драйвера: убираем параметры, которые понимает только клиент Neon.
 * `channel_binding` есть в шаблоне Neon, но node-postgres его не использует и
 * в старых версиях спотыкается на незнакомом параметре СКРАМ-аутентификации.
 */
export function sanitizeConnectionString(raw: string): string {
  const value = normalizeRaw(raw);
  if (!/^postgres(ql)?:\/\//i.test(value)) return value;
  try {
    const parsed = new URL(value);
    parsed.searchParams.delete("channel_binding");
    return parsed.toString();
  } catch {
    // Разобрать не смогли — отдаём как есть, ошибку покажет адаптер.
    return value;
  }
}

/** Готовая подсказка для логов и `/api/health`: одна строка, без секретов. */
export function dbUrlHint(report: DbUrlReport): string {
  if (report.problems.length === 0) return "";
  return [
    ...report.problems,
    "Шаблон: postgresql://ПОЛЬЗОВАТЕЛЬ:ПАРОЛЬ@ХОСТ/БАЗА?sslmode=require",
    "Где взять: Neon → Project → Connect → Connection string (ветка main).",
  ].join(" ");
}
