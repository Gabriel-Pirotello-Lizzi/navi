import { addMonthsISO } from "./dates";

export function splitInstallments(totalCents: number, count: number) {
  const safeCount = Math.max(1, Math.floor(count));
  const base = Math.floor(totalCents / safeCount);
  const remainder = totalCents - base * safeCount;
  return Array.from({ length: safeCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function buildInstallmentSchedule(totalCents: number, count: number, firstDate: string) {
  return splitInstallments(totalCents, count).map((amountCents, index) => ({
    installmentNumber: index + 1,
    installmentCount: count,
    occurredOn: addMonthsISO(firstDate, index),
    amountCents,
  }));
}
