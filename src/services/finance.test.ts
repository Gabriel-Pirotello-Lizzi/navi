import { describe, expect, it } from "vitest";
import type { Account, CreditCard, Invoice, RecurringTemplate, Transaction } from "@/src/domain/types";
import { accountBalance, cycleIntelligence, isConsumption, monthlyConsumption } from "./calculation-service";
import { splitInstallments } from "./installment-service";
import { invoiceTotal } from "./invoice-service";
import { parseBRL } from "./money";

const baseTransaction: Transaction = {
  id: "t",
  kind: "expense",
  status: "paid",
  amount_cents: 1000,
  description: "Teste",
  category: "Outros",
  category_id: null,
  account_id: "a",
  destination_account_id: null,
  credit_card_id: null,
  invoice_id: null,
  installment_plan_id: null,
  installment_number: null,
  installment_count: null,
  occurred_on: "2026-07-28",
  notes: null,
  source: "manual",
  source_fingerprint: null,
  created_at: "2026-07-28T12:00:00Z",
};

const account: Account = {
  id: "a",
  name: "Conta",
  institution: null,
  type: "checking",
  initial_balance_cents: 10000,
  balance_as_of: "2026-07-01",
  color: "#000",
  icon: "wallet",
  is_active: true,
};

describe("dinheiro em centavos", () => {
  it("interpreta padrão brasileiro sem erro de ponto flutuante", () => {
    expect(parseBRL("R$ 4.419,14")).toBe(441914);
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
  });
});

describe("conceitos financeiros", () => {
  it("compra no cartão é consumo, mas não reduz a conta", () => {
    const purchase = { ...baseTransaction, kind: "card_purchase" as const, credit_card_id: "c", account_id: null };
    expect(isConsumption(purchase)).toBe(true);
    expect(accountBalance(account, [purchase])).toBe(10000);
  });

  it("pagamento da fatura reduz a conta, mas não duplica consumo", () => {
    const purchase = { ...baseTransaction, kind: "card_purchase" as const, credit_card_id: "c", account_id: null };
    const payment = { ...baseTransaction, id: "p", kind: "card_payment" as const, amount_cents: 1000 };
    expect(accountBalance(account, [purchase, payment])).toBe(9000);
    expect(monthlyConsumption([purchase, payment], "2026-07")).toBe(1000);
  });

  it("transferência só move dinheiro entre contas", () => {
    const transfer = { ...baseTransaction, kind: "transfer" as const, destination_account_id: "b" };
    const destination = { ...account, id: "b", initial_balance_cents: 5000 };
    expect(accountBalance(account, [transfer])).toBe(9000);
    expect(accountBalance(destination, [transfer])).toBe(6000);
    expect(monthlyConsumption([transfer], "2026-07")).toBe(0);
  });

  it("estorno reduz a fatura e o consumo", () => {
    const purchase = { ...baseTransaction, kind: "card_purchase" as const, amount_cents: 5000 };
    const refund = { ...baseTransaction, id: "r", kind: "refund" as const, amount_cents: 1200 };
    expect(invoiceTotal([purchase, refund])).toBe(3800);
    expect(monthlyConsumption([purchase, refund], "2026-07")).toBe(3800);
  });
});

describe("inteligência até a fatura", () => {
  it("soma entradas e protege fatura e saídas fixas até o dia 8", () => {
    const card = {
      id: "c", account_id: "a", name: "Cartão", institution: null, last_four: null,
      limit_cents: 100000, closing_day: 1, due_day: 8, color: "#000", is_active: true,
    } satisfies CreditCard;
    const invoice = {
      id: "i", credit_card_id: "c", reference_month: "2026-08-01", closing_date: null,
      due_date: "2026-08-08", total_cents: 3000, status: "open", paid_at: null,
      payment_account_id: null,
    } satisfies Invoice;
    const recurringBase = {
      id: "r", category_id: null, account_id: "a", destination_account_id: null,
      frequency: "monthly", day_of_month: 5, starts_on: "2026-01-05", ends_on: null,
      next_due_on: "2026-08-05", is_active: true, is_fixed: true, notes: null,
    } as const;
    const recurrings: RecurringTemplate[] = [
      { ...recurringBase, kind: "income", description: "Salário", amount_cents: 5000 },
      { ...recurringBase, id: "e", kind: "expense", description: "Aluguel", amount_cents: 1000 },
    ];
    const result = cycleIntelligence({
      profile: null, accounts: [account], cards: [card], transactions: [],
      invoices: [invoice], recurrings, goals: [],
    }, new Date(2026, 6, 29));
    expect(result.dueDate).toBe("2026-08-08");
    expect(result.availableUntilDue).toBe(11000);
    expect(result.daysUntilDue).toBe(11);
    expect(result.safePerDay).toBe(1000);
  });
});
