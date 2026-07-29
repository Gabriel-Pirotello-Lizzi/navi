export type UUID = string;
export type TransactionKind =
  | "expense" | "income" | "transfer" | "card_purchase"
  | "card_payment" | "refund" | "goal_contribution" | "adjustment";
export type TransactionStatus = "planned" | "pending" | "paid" | "cancelled";

export interface Profile {
  id: UUID;
  display_name: string | null;
  monthly_income_cents: number;
  fixed_costs_cents: number;
  income_day: number;
  onboarding_completed: boolean;
  daily_limit_mode: "conservative" | "cashflow";
  reserve_percent: number;
  seed_version: number;
}

export interface Account {
  id: UUID;
  name: string;
  institution: string | null;
  type: "checking" | "savings" | "cash" | "investment" | "other";
  initial_balance_cents: number;
  balance_as_of: string;
  color: string;
  icon: string;
  is_active: boolean;
}

export interface CreditCard {
  id: UUID;
  account_id: UUID | null;
  name: string;
  institution: string | null;
  last_four: string | null;
  limit_cents: number;
  closing_day: number | null;
  due_day: number;
  color: string;
  is_active: boolean;
}

export interface Category {
  id: UUID;
  name: string;
  kind: "expense" | "income" | "both";
  parent_id: UUID | null;
  icon: string;
  color: string;
  is_system: boolean;
  is_active: boolean;
}

export interface Transaction {
  id: UUID;
  kind: TransactionKind;
  status: TransactionStatus;
  amount_cents: number;
  description: string;
  category: string;
  category_id: UUID | null;
  account_id: UUID | null;
  destination_account_id: UUID | null;
  credit_card_id: UUID | null;
  invoice_id: UUID | null;
  installment_plan_id: UUID | null;
  installment_number: number | null;
  installment_count: number | null;
  occurred_on: string;
  notes: string | null;
  source: string;
  source_fingerprint: string | null;
  created_at: string;
  pending?: boolean;
}

export interface Invoice {
  id: UUID;
  credit_card_id: UUID;
  reference_month: string;
  closing_date: string | null;
  due_date: string;
  total_cents: number;
  status: "open" | "closed" | "paid" | "overdue";
  paid_at: string | null;
  payment_account_id: UUID | null;
}

export interface InstallmentPlan {
  id: UUID;
  credit_card_id: UUID | null;
  description: string;
  category_id: UUID | null;
  total_cents: number;
  installment_cents: number;
  installment_count: number;
  first_installment_on: string;
  status: "active" | "completed" | "cancelled";
}

export interface RecurringTemplate {
  id: UUID;
  kind: "expense" | "income" | "transfer";
  description: string;
  amount_cents: number;
  category_id: UUID | null;
  account_id: UUID | null;
  destination_account_id: UUID | null;
  frequency: "weekly" | "monthly" | "yearly";
  day_of_month: number | null;
  starts_on: string;
  ends_on: string | null;
  next_due_on: string;
  is_active: boolean;
}

export interface Budget {
  id: UUID;
  category_id: UUID;
  reference_month: string;
  limit_cents: number;
  rollover: boolean;
}

export interface Goal {
  id: UUID;
  title: string;
  target_cents: number;
  saved_cents: number;
  target_date: string | null;
  monthly_contribution_cents: number;
  status: "active" | "completed" | "paused" | "cancelled";
  protected: boolean;
  color: string;
  notes: string | null;
}

export interface Workspace {
  profile: Profile | null;
  accounts: Account[];
  creditCards: CreditCard[];
  categories: Category[];
  transactions: Transaction[];
  invoices: Invoice[];
  installmentPlans: InstallmentPlan[];
  recurrings: RecurringTemplate[];
  budgets: Budget[];
  goals: Goal[];
}

export type DraftTransaction = {
  kind: TransactionKind;
  status: TransactionStatus;
  description: string;
  amount: string;
  categoryId: string;
  accountId: string;
  destinationAccountId: string;
  creditCardId: string;
  occurredOn: string;
  installmentCount: number;
  notes: string;
};
