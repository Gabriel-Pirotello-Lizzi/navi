import type { Account, Budget, Category, Goal, Invoice, Profile, Transaction } from "@/src/domain/types";
import { daysRemainingInMonth, monthKey } from "./dates";

const consumptionKinds = new Set(["expense", "card_purchase"]);

export function isConsumption(transaction: Transaction) {
  return consumptionKinds.has(transaction.kind) && transaction.status !== "cancelled";
}

export function accountBalance(account: Account, transactions: Transaction[]) {
  return transactions.reduce((balance, item) => {
    if (item.status !== "paid" || item.occurred_on < account.balance_as_of) return balance;
    if (item.kind === "income" && item.account_id === account.id) return balance + item.amount_cents;
    if (["expense", "card_payment", "goal_contribution"].includes(item.kind) && item.account_id === account.id) return balance - item.amount_cents;
    if (item.kind === "refund" && item.account_id === account.id) return balance + item.amount_cents;
    if (item.kind === "transfer") {
      if (item.account_id === account.id) return balance - item.amount_cents;
      if (item.destination_account_id === account.id) return balance + item.amount_cents;
    }
    return balance;
  }, account.initial_balance_cents);
}

export function totalAccountBalance(accounts: Account[], transactions: Transaction[]) {
  return accounts.filter((item) => item.is_active).reduce((sum, account) => sum + accountBalance(account, transactions), 0);
}

export function monthlyConsumption(transactions: Transaction[], month = monthKey()) {
  return transactions
    .filter((item) => item.occurred_on.startsWith(month) && isConsumption(item))
    .reduce((sum, item) => sum + item.amount_cents, 0)
    - transactions
      .filter((item) => item.occurred_on.startsWith(month) && item.kind === "refund" && item.status !== "cancelled")
      .reduce((sum, item) => sum + item.amount_cents, 0);
}

export function pendingCardDebt(invoices: Invoice[]) {
  return invoices.filter((invoice) => invoice.status !== "paid").reduce((sum, invoice) => sum + invoice.total_cents, 0);
}

export function availableToday(input: {
  profile: Profile | null;
  accounts: Account[];
  transactions: Transaction[];
  invoices: Invoice[];
  goals: Goal[];
}) {
  const { profile, accounts, transactions, invoices, goals } = input;
  const cash = totalAccountBalance(accounts, transactions);
  const debt = pendingCardDebt(invoices);
  const plannedGoals = goals
    .filter((goal) => goal.status === "active" && goal.protected)
    .reduce((sum, goal) => sum + goal.monthly_contribution_cents, 0);
  const month = monthKey();
  const pendingCash = transactions
    .filter((item) => item.occurred_on.startsWith(month) && item.status === "planned" && item.kind === "expense")
    .reduce((sum, item) => sum + item.amount_cents, 0);
  const conservativeCommitments = debt + pendingCash + plannedGoals;
  const cashflowCommitments = pendingCash + plannedGoals;
  const protectedCents = profile?.daily_limit_mode === "cashflow" ? cashflowCommitments : conservativeCommitments;
  const availableMonth = Math.max(0, cash - protectedCents);
  return {
    cash,
    debt,
    plannedGoals,
    protectedCents,
    availableMonth,
    availableToday: Math.floor(availableMonth / daysRemainingInMonth()),
    daysLeft: daysRemainingInMonth(),
  };
}

export function budgetProgress(
  budgets: Budget[],
  categories: Category[],
  transactions: Transaction[],
  month = monthKey(),
) {
  return budgets.filter((budget) => budget.reference_month.startsWith(month)).map((budget) => {
    const category = categories.find((item) => item.id === budget.category_id);
    const spent = transactions
      .filter((item) => item.occurred_on.startsWith(month) && item.category_id === budget.category_id && isConsumption(item))
      .reduce((sum, item) => sum + item.amount_cents, 0);
    return {
      ...budget,
      name: category?.name ?? "Sem categoria",
      color: category?.color ?? "#64748b",
      spent,
      remaining: budget.limit_cents - spent,
      usage: budget.limit_cents > 0 ? Math.round((spent / budget.limit_cents) * 100) : 0,
    };
  });
}

export function projectTwelveMonths(profile: Profile | null, transactions: Transaction[], goals: Goal[]) {
  const base = new Date();
  return Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const income = profile?.monthly_income_cents ?? 0;
    const expenses = transactions
      .filter((item) => item.occurred_on.startsWith(key) && isConsumption(item))
      .reduce((sum, item) => sum + item.amount_cents, 0);
    const goalsContribution = goals.filter((goal) => goal.status === "active").reduce((sum, goal) => sum + goal.monthly_contribution_cents, 0);
    return { month: key, income, expenses, goalsContribution, projectedBalance: income - expenses - goalsContribution };
  });
}
