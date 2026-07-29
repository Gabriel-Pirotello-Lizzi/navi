import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { DraftTransaction, Goal, Workspace } from "@/src/domain/types";
import { parseBRL } from "./money";
import { buildInstallmentSchedule } from "./installment-service";
import { invoiceReferenceForPurchase } from "./invoice-service";

const workspaceQueries = [
  ["profile", "profiles", "id", false],
  ["accounts", "accounts", "created_at", true],
  ["creditCards", "credit_cards", "created_at", true],
  ["categories", "categories", "name", true],
  ["transactions", "transactions", "occurred_on", false],
  ["invoices", "invoices", "due_date", false],
  ["installmentPlans", "installment_plans", "created_at", false],
  ["recurrings", "recurring_templates", "next_due_on", true],
  ["budgets", "budgets", "reference_month", false],
  ["goals", "goals", "created_at", false],
] as const;

export async function loadWorkspace(client: SupabaseClient, user: User): Promise<Workspace> {
  void user;
  const results = await Promise.all(workspaceQueries.map(([, table, order, ascending]) =>
    client.from(table).select("*").order(order, { ascending }),
  ));
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const data = Object.fromEntries(workspaceQueries.map(([key], index) => [key, results[index].data ?? []])) as unknown as Workspace;
  data.profile = (results[0].data?.[0] ?? null) as Workspace["profile"];
  return data;
}

export async function saveTransaction(client: SupabaseClient, workspace: Workspace, draft: DraftTransaction) {
  const amountCents = parseBRL(draft.amount);
  if (amountCents <= 0 || !draft.description.trim()) throw new Error("Informe uma descrição e um valor válido.");
  const category = workspace.categories.find((item) => item.id === draft.categoryId);
  const card = workspace.creditCards.find((item) => item.id === draft.creditCardId);
  const base = {
    kind: draft.kind,
    status: draft.status,
    amount_cents: amountCents,
    description: draft.description.trim(),
    category: category?.name ?? "Outros",
    category_id: category?.id ?? null,
    account_id: draft.accountId || null,
    destination_account_id: draft.destinationAccountId || null,
    credit_card_id: draft.creditCardId || null,
    occurred_on: draft.occurredOn,
    notes: draft.notes.trim() || null,
    source: "manual",
  };

  if (draft.kind === "card_purchase" && card) {
    const referenceMonth = invoiceReferenceForPurchase(draft.occurredOn, card);
    const dueDate = `${referenceMonth.slice(0, 8)}${String(card.due_day).padStart(2, "0")}`;
    const { data: invoice, error: invoiceError } = await client.from("invoices").upsert({
      credit_card_id: card.id,
      reference_month: referenceMonth,
      due_date: dueDate,
      status: "open",
    }, { onConflict: "user_id,credit_card_id,reference_month" }).select().single();
    if (invoiceError) throw invoiceError;
    if (draft.installmentCount > 1) {
      const schedule = buildInstallmentSchedule(amountCents, draft.installmentCount, draft.occurredOn);
      const { data: plan, error: planError } = await client.from("installment_plans").insert({
        credit_card_id: card.id,
        description: base.description,
        category_id: base.category_id,
        total_cents: amountCents,
        installment_cents: schedule[0].amountCents,
        installment_count: draft.installmentCount,
        first_installment_on: draft.occurredOn,
      }).select().single();
      if (planError) throw planError;
      const scheduledInvoices = [];
      for (const installment of schedule) {
        const installmentReference = invoiceReferenceForPurchase(installment.occurredOn, card);
        const installmentDue = `${installmentReference.slice(0, 8)}${String(card.due_day).padStart(2, "0")}`;
        const { data: scheduledInvoice, error: scheduledInvoiceError } = await client.from("invoices").upsert({
          credit_card_id: card.id,
          reference_month: installmentReference,
          due_date: installmentDue,
          status: "open",
        }, { onConflict: "user_id,credit_card_id,reference_month" }).select().single();
        if (scheduledInvoiceError) throw scheduledInvoiceError;
        scheduledInvoices.push(scheduledInvoice);
      }
      const rows = schedule.map((installment, index) => ({
        ...base,
        amount_cents: installment.amountCents,
        occurred_on: installment.occurredOn,
        invoice_id: scheduledInvoices[index].id,
        installment_plan_id: plan.id,
        installment_number: installment.installmentNumber,
        installment_count: installment.installmentCount,
      }));
      const { error } = await client.from("transactions").insert(rows);
      if (error) throw error;
      for (const scheduledInvoice of scheduledInvoices) {
        await client.rpc("recalculate_invoice_total", { target_invoice_id: scheduledInvoice.id });
      }
      return;
    }
    const { error } = await client.from("transactions").insert({ ...base, invoice_id: invoice.id });
    if (error) throw error;
    await client.rpc("recalculate_invoice_total", { target_invoice_id: invoice.id });
    return;
  }
  const { error } = await client.from("transactions").insert(base);
  if (error) throw error;
  if (draft.kind === "card_payment" && card) {
    const invoiceToPay = workspace.invoices
      .filter((item) => item.credit_card_id === card.id && item.status !== "paid")
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    if (invoiceToPay) {
      const { error: invoicePaymentError } = await client.from("invoices").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payment_account_id: draft.accountId || null,
      }).eq("id", invoiceToPay.id);
      if (invoicePaymentError) throw invoicePaymentError;
    }
  }
}

export async function deleteTransaction(client: SupabaseClient, id: string) {
  const { error } = await client.from("transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function saveEntity(
  client: SupabaseClient,
  table: "accounts" | "credit_cards" | "budgets" | "recurring_templates",
  payload: Record<string, unknown>,
) {
  const { error } = await client.from(table).insert(payload);
  if (error) throw error;
}

export async function saveGoal(client: SupabaseClient, payload: Partial<Goal>) {
  const { error } = await client.from("goals").insert(payload);
  if (error) throw error;
}

export async function contributeToGoal(client: SupabaseClient, goal: Goal, amountCents: number, accountId: string | null) {
  const { error: contributionError } = await client.from("goal_contributions").insert({
    goal_id: goal.id,
    account_id: accountId,
    amount_cents: amountCents,
  });
  if (contributionError) throw contributionError;
  const { error } = await client.from("goals").update({
    saved_cents: goal.saved_cents + amountCents,
    status: goal.saved_cents + amountCents >= goal.target_cents ? "completed" : goal.status,
  }).eq("id", goal.id);
  if (error) throw error;
}
