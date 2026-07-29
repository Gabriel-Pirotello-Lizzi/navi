import type { CreditCard, Transaction } from "@/src/domain/types";
import { addMonthsISO, monthStart } from "./dates";

export function invoiceReferenceForPurchase(occurredOn: string, card: CreditCard) {
  if (!card.closing_day) return monthStart(occurredOn);
  const purchaseDay = Number(occurredOn.slice(8, 10));
  return monthStart(purchaseDay > card.closing_day ? addMonthsISO(occurredOn, 1) : occurredOn);
}

export function invoiceTotal(transactions: Transaction[]) {
  return transactions.reduce((sum, item) => {
    if (item.status === "cancelled") return sum;
    if (item.kind === "card_purchase") return sum + item.amount_cents;
    if (item.kind === "refund") return sum - item.amount_cents;
    return sum;
  }, 0);
}

export function cardPaymentIsConsumption() {
  return false;
}
