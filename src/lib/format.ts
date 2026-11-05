/** Денежные и текстовые форматтеры витрины. Один вид цен на всех экранах. */

export function money(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString("ru-RU").replace(/\u00a0|\u202f/g, " ")} ₽`;
}

/** Склонение: 1 позиция, 2 позиции, 5 позиций. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function quantityLabel(count: number): string {
  return `${count} ${plural(count, "товар", "товара", "товаров")}`;
}

export function shortDate(value: string | number): string {
  const date = new Date(typeof value === "number" ? value : value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Телефон → «+7 900 000-00-00»; нецифровые символы отбрасываются. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  const rest = digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
  const parts = [rest.slice(0, 1), rest.slice(1, 4), rest.slice(4, 7), rest.slice(7, 9), rest.slice(9, 11)].filter(Boolean);
  if (parts.length === 1) return `+${parts[0]}`;
  let out = `+${parts[0]} ${parts[1] ?? ""}`.trimEnd();
  if (parts[2]) out += ` ${parts[2]}`;
  if (parts[3]) out += `-${parts[3]}`;
  if (parts[4]) out += `-${parts[4]}`;
  return out;
}
