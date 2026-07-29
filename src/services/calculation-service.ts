import type { Account, Budget, Category, CreditCard, Goal, Invoice, Profile, RecurringTemplate, Transaction } from "@/src/domain/types";
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

function dateFromISO(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoFromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addFrequency(value: Date, frequency: RecurringTemplate["frequency"]) {
  const next = new Date(value);
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  if (frequency === "yearly") next.setFullYear(next.getFullYear() + 1);
  return next;
}

function recurringAmountUntil(items: RecurringTemplate[], kind: "income" | "expense", from: Date, to: Date) {
  return items.filter((item) => item.is_active && item.kind === kind).reduce((sum, item) => {
    let occurrence = dateFromISO(item.next_due_on || item.starts_on);
    let guard = 0;
    while (occurrence < from && guard++ < 240) occurrence = addFrequency(occurrence, item.frequency);
    while (occurrence <= to && guard++ < 240) {
      if (!item.ends_on || occurrence <= dateFromISO(item.ends_on)) sum += item.amount_cents;
      occurrence = addFrequency(occurrence, item.frequency);
    }
    return sum;
  }, 0);
}

export function cycleIntelligence(input: {
  profile: Profile | null;
  accounts: Account[];
  cards: CreditCard[];
  transactions: Transaction[];
  invoices: Invoice[];
  recurrings: RecurringTemplate[];
  goals: Goal[];
}, today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const futureInvoice = input.invoices
    .filter((item) => item.status !== "paid" && dateFromISO(item.due_date) >= start)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  let dueDate = futureInvoice ? dateFromISO(futureInvoice.due_date) : null;
  if (!dueDate) {
    const dueDay = input.cards.find((item) => item.is_active)?.due_day ?? 8;
    dueDate = new Date(start.getFullYear(), start.getMonth(), Math.min(dueDay, 28));
    if (dueDate < start) dueDate = new Date(start.getFullYear(), start.getMonth() + 1, Math.min(dueDay, 28));
  }
  const dueISO = isoFromDate(dueDate);
  const cash = totalAccountBalance(input.accounts, input.transactions);
  const fixedIncome = recurringAmountUntil(input.recurrings, "income", start, dueDate);
  const fixedExpenses = recurringAmountUntil(input.recurrings, "expense", start, dueDate);
  const invoiceDue = input.invoices
    .filter((item) => item.status !== "paid" && item.due_date <= dueISO)
    .reduce((sum, item) => sum + item.total_cents, 0);
  const plannedCash = input.transactions
    .filter((item) => item.status === "planned" && item.occurred_on >= isoFromDate(start) && item.occurred_on <= dueISO && item.kind === "expense")
    .reduce((sum, item) => sum + item.amount_cents, 0);
  const protectedGoals = input.goals
    .filter((item) => item.status === "active" && item.protected)
    .reduce((sum, item) => sum + item.monthly_contribution_cents, 0);
  const commitments = fixedExpenses + invoiceDue + plannedCash + protectedGoals;
  const availableUntilDue = cash + fixedIncome - commitments;
  const daysUntilDue = Math.max(1, Math.ceil((dueDate.getTime() - start.getTime()) / 86_400_000) + 1);
  return {
    cash,
    fixedIncome,
    fixedExpenses,
    invoiceDue,
    plannedCash,
    protectedGoals,
    commitments,
    availableUntilDue,
    safePerDay: Math.floor(Math.max(0, availableUntilDue) / daysUntilDue),
    shortfall: Math.max(0, -availableUntilDue),
    dueDate: dueISO,
    daysUntilDue,
  };
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

export function projectTwelveMonths(profile: Profile | null, transactions: Transaction[], goals: Goal[], recurrings: RecurringTemplate[] = []) {
  const base = new Date();
  return Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const recurringIncome = recurrings.filter((item) => item.is_active && item.kind === "income").reduce((sum, item) => sum + item.amount_cents, 0);
    const recurringExpenses = recurrings.filter((item) => item.is_active && item.kind === "expense").reduce((sum, item) => sum + item.amount_cents, 0);
    const income = recurringIncome || profile?.monthly_income_cents || 0;
    const recordedExpenses = transactions
      .filter((item) => item.occurred_on.startsWith(key) && isConsumption(item))
      .reduce((sum, item) => sum + item.amount_cents, 0);
    const expenses = Math.max(recordedExpenses, recurringExpenses);
    const goalsContribution = goals.filter((goal) => goal.status === "active").reduce((sum, goal) => sum + goal.monthly_contribution_cents, 0);
    return { month: key, income, expenses, goalsContribution, projectedBalance: income - expenses - goalsContribution };
  });
}

export function smartInsights(input: {
  cycle: ReturnType<typeof cycleIntelligence>;
  budgets: ReturnType<typeof budgetProgress>;
  transactions: Transaction[];
}) {
  const messages: Array<{ tone: "good" | "attention" | "danger"; title: string; text: string }> = [];
  if (input.cycle.shortfall > 0) messages.push({
    tone: "danger",
    title: "A fatura pede ajuste",
    text: `Faltam ${input.cycle.shortfall} centavos para cobrir tudo até o vencimento.`,
  });
  else messages.push({
    tone: "good",
    title: "Ciclo protegido",
    text: `Depois dos compromissos, ainda sobram ${input.cycle.availableUntilDue} centavos até a fatura.`,
  });
  const over = [...input.budgets].sort((a, b) => b.usage - a.usage)[0];
  if (over && over.usage >= 80) messages.push({
    tone: over.usage > 100 ? "danger" : "attention",
    title: `${over.name} em foco`,
    text: `Você já usou ${over.usage}% do limite dessa categoria.`,
  });
  const installmentTotal = input.transactions
    .filter((item) => item.status !== "cancelled" && item.installment_plan_id && item.installment_number === 1)
    .reduce((sum, item) => sum + item.amount_cents * (item.installment_count ?? 1), 0);
  if (installmentTotal > 0) messages.push({
    tone: "attention",
    title: "Compromissos parcelados",
    text: "As parcelas futuras já entram na projeção e não somem depois do fechamento da fatura.",
  });
  return messages.slice(0, 3);
}
