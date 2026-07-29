export function formatBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export function parseBRL(value: string) {
  const cleaned = value.trim().replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function percent(value: number, total: number) {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((value / total) * 100))) : 0;
}
