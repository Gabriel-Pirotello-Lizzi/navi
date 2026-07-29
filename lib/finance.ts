export type TransactionKind = "expense" | "income";

export type Profile = {
  id: string;
  display_name: string | null;
  monthly_income_cents: number;
  fixed_costs_cents: number;
  income_day: number;
  onboarding_completed: boolean;
};

export type Transaction = {
  id: string;
  kind: TransactionKind;
  amount_cents: number;
  description: string;
  category: string;
  occurred_on: string;
  created_at: string;
  pending?: boolean;
};

export type Goal = {
  id: string;
  title: string;
  target_cents: number;
  saved_cents: number;
  target_date: string | null;
};

export type PendingTransaction = Omit<Transaction, "id" | "created_at" | "pending"> & { requestId: string };

export const categoryVisuals: Record<string, { icon: string; tone: string }> = {
  Mercado: { icon: "🛒", tone: "#e8f6ee" },
  Transporte: { icon: "↗", tone: "#e9f2ff" },
  Casa: { icon: "⌂", tone: "#fff2e3" },
  Lazer: { icon: "✦", tone: "#f7edff" },
  Assinaturas: { icon: "◉", tone: "#f7edff" },
  Saúde: { icon: "＋", tone: "#ffecef" },
  Renda: { icon: "↗", tone: "#e7f8f0" },
  Outros: { icon: "•", tone: "#eef1f6" },
};

export const categories = Object.keys(categoryVisuals).filter((category) => !["Renda", "Outros"].includes(category));

export function moneyFromCents(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

export function parseMoneyToCents(value: string) {
  const normalized = value.replace(/[^\d,]/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function currentMonthTransactions(transactions: Transaction[]) {
  const month = new Date().toISOString().slice(0, 7);
  return transactions.filter((transaction) => transaction.occurred_on.startsWith(month));
}

export function calculatePlan(profile: Profile, transactions: Transaction[]) {
  const monthTransactions = currentMonthTransactions(transactions);
  const expenses = monthTransactions.filter((item) => item.kind === "expense").reduce((total, item) => total + item.amount_cents, 0);
  const extraIncome = monthTransactions.filter((item) => item.kind === "income").reduce((total, item) => total + item.amount_cents, 0);
  const monthlyBudget = Math.max(0, profile.monthly_income_cents + extraIncome - profile.fixed_costs_cents);
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate() + 1);
  const availableToday = Math.max(0, Math.floor((monthlyBudget - expenses) / daysLeft));
  const usage = monthlyBudget ? Math.min(100, Math.round((expenses / monthlyBudget) * 100)) : 0;
  return { expenses, extraIncome, monthlyBudget, availableToday, usage, daysLeft };
}

export function profileDisplayName(profile: Profile | null, fallback: string) {
  return profile?.display_name?.trim() || fallback || "você";
}
