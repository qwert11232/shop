/**
 * Разбор текста, который владелец присылает боту.
 *
 * Всё, что вводится руками, проверяется здесь — и ничего не зависит от Telegram,
 * поэтому правила проверяются в `check:bot` без сети. Принцип: лучше отказать
 * с понятным текстом, чем записать «12a» в цену.
 */

/**
 * Цена: «89 990», «89990 ₽», «89.990» → копейки. Максимум 100 млн ₽.
 *
 * Ошибка в цене дороже любой другой: «12a» не должно превращаться в 12 ₽.
 * Поэтому буквы (кроме обозначения рублей) и неоднозначные дроби отклоняются,
 * а точка/запятая считаются разделителем тысяч только в виде «12.000».
 */
export function parsePriceRub(raw: string): number | null {
  // Убираем только «валюту» и пробелы; всё остальное должно быть цифрами.
  const cleaned = raw
    .replace(/₽|руб\.?|р\./gi, "")
    .replace(/[\s\u00a0]/g, "")
    .trim();
  if (!cleaned) return null;

  let digits: string;
  if (/^\d{1,3}([.,]\d{3})+$/.test(cleaned)) {
    digits = cleaned.replace(/[.,]/g, ""); // 89.990 → 89990
  } else if (/^\d{1,9}$/.test(cleaned)) {
    digits = cleaned; // 89990
  } else {
    // «12a», «12.5», «8,90» — не рублёвая сумма: пусть владелец пришлёт целое число.
    return null;
  }

  const rubles = Number(digits);
  if (!Number.isFinite(rubles) || rubles <= 0 || rubles > 100_000_000) return null;
  return rubles * 100;
}

/** Копейки → «89 990 ₽» без NBSP: тот же вид, что и в интерфейсе. */
export function money(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;
}

export type SpecLine = { group: string; name: string; value: string; unit: string; numeric: number | null };

/**
 * Характеристики построчно: «Память: 256 ГБ», «Вес = 1,2 кг».
 * Группа по умолчанию — «Основное»; единица измерения вынимается из значения,
 * чтобы фильтр в витрине мог показывать «256 ГБ», а не «256».
 */
export function parseSpecLines(raw: string): { specs: SpecLine[]; skipped: string[] } {
  const specs: SpecLine[] = [];
  const skipped: string[] = [];
  for (const line of raw.split(/\n|;/)) {
    const text = line.trim();
    if (!text) continue;
    const match = text.match(/^([^:=]+?)\s*[:=]\s*(.+)$/);
    if (!match) {
      skipped.push(text);
      continue;
    }
    const name = match[1].trim().slice(0, 60);
    const rest = match[2].trim().slice(0, 80);
    if (name.length < 2 || rest.length === 0) {
      skipped.push(text);
      continue;
    }
    // «256 ГБ» → value 256, unit ГБ; «титан» → value целиком, unit пустой.
    const withUnit = rest.match(/^([\d.,]+)\s*([^\d\s].{0,9})?$/);
    if (withUnit) {
      const value = withUnit[1].replace(",", ".");
      specs.push({
        group: groupFor(name),
        name,
        value: withUnit[1],
        unit: (withUnit[2] ?? "").trim(),
        numeric: Number(value),
      });
    } else {
      specs.push({ group: groupFor(name), name, value: rest, unit: "", numeric: null });
    }
  }
  return { specs, skipped };
}

/** Группа для таблицы характеристик — по смыслу характеристики, а не вручную. */
export function groupFor(name: string): string {
  const key = name.toLowerCase();
  if (/(память|ssd|накопител|озу|частота|процессор)/.test(key)) return "Производительность";
  if (/(экран|диагонал|разрешение|камера|матрица)/.test(key)) return "Экран и камера";
  if (/(мощност|питани|автономн|аккумулятор|батаре)/.test(key)) return "Питание";
  if (/(вес|габарит|размер|цвет|материал)/.test(key)) return "Корпус";
  return "Основное";
}

/**
 * Вариант: «256 ГБ +8000» — надбавка необязательна, минус разрешён.
 * Метка должна содержать хоть одну букву или цифру: «??» — это опечатка,
 * а не название цвета, и молча создавать такой вариант нельзя.
 */
export function parseVariantLine(raw: string): { label: string; extraRub: number } | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (!/[a-zA-Zа-яА-ЯёЁ0-9]/.test(text)) return null;
  const match = text.match(/^(.{1,40}?)(?:\s*([+-])\s*([\d\s.,]+))?$/);
  if (!match) return null;
  const label = match[1].trim();
  if (label.length < 1 || !/[a-zA-Zа-яА-ЯёЁ0-9]/.test(label)) return null;
  const sign = match[2] === "-" ? -1 : 1;
  const amount = Number((match[3] ?? "0").replace(/[\s.,]/g, ""));
  if (!Number.isFinite(amount) || amount > 10_000_000) return null;
  return { label, extraRub: sign * amount };
}

/** Вид варианта: цвет, память, комплектация — влияет на подписи в карточке. */
export function guessVariantKind(label: string): "color" | "storage" | "config" | "size" {
  const key = label.toLowerCase();
  if (/(чёрн|черн|бел|титан|син|красн|зелён|зелен|сер|золот|серебр)/.test(key)) return "color";
  if (/(гб|тб|мб|гбайт|терабайт)/.test(key)) return "storage";
  if (/(размер|см|мм|дюйм|")/.test(key)) return "size";
  return "config";
}

/** Телефон: 10–15 цифр, формат не важен — приводим к «+7…». */
export function parsePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  const onlyDigits = digits.replace(/\D/g, "");
  if (onlyDigits.length < 10 || onlyDigits.length > 15) return null;
  if (onlyDigits.length === 11 && onlyDigits.startsWith("8")) return `+7${onlyDigits.slice(1)}`;
  return digits.startsWith("+") ? digits : `+${onlyDigits}`;
}

/** Артикул/ID: только безопасные символы, иначе параметры URL поедут. */
export function parseId(raw: string): string | null {
  const value = raw.trim();
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(value)) return null;
  return value;
}

/** Причина возврата: бот спрашивает комментарий клиента и объяснение отмены. */
export function parseComment(raw: string, max = 300): string {
  return raw.trim().slice(0, max);
}
