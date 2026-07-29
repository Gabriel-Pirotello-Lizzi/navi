export function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthKey(value = localISODate()) {
  return value.slice(0, 7);
}

export function monthStart(value = localISODate()) {
  return `${monthKey(value)}-01`;
}

export function monthLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
    .format(new Date(`${value.slice(0, 7)}-01T12:00:00`));
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" })
    .format(new Date(`${value}T12:00:00`));
}

export function daysRemainingInMonth(value = new Date()) {
  const last = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate();
  return Math.max(1, last - value.getDate() + 1);
}

export function addMonthsISO(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  return localISODate(date);
}
