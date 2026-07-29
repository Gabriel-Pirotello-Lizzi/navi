import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type {
  Account, CreditCard, DraftTransaction, Goal, InstallmentPlan,
  Profile, RecurringTemplate, Transaction, Workspace,
} from "@/src/domain/types";
import {
  budgetProgress, cycleIntelligence, monthlyConsumption, projectTwelveMonths,
  totalAccountBalance,
} from "@/src/services/calculation-service";
import { downloadBackup, transactionsToCSV } from "@/src/services/backup-service";
import { localISODate, monthLabel, monthStart, shortDate } from "@/src/services/dates";
import {
  deleteEntity, deleteTransaction, loadWorkspace, saveTransaction, updateTransaction,
  upsertEntity,
} from "@/src/services/finance-repository";
import { formatBRL, parseBRL, percent } from "@/src/services/money";

type View = "Início" | "Lançamentos" | "Planejamento" | "Contas" | "Cartões" | "Orçamentos" | "Metas" | "Mais";
type EditorKind = "transaction" | "profile" | "account" | "card" | "budget" | "recurring" | "installment" | "goal";
type EditorState = { kind: EditorKind; item?: Record<string, unknown> } | null;
type EntityTable = "profiles" | "accounts" | "credit_cards" | "budgets" | "recurring_templates" | "installment_plans" | "goals";

const emptyWorkspace: Workspace = {
  profile: null, accounts: [], creditCards: [], categories: [], transactions: [],
  invoices: [], installmentPlans: [], recurrings: [], budgets: [], goals: [],
};
const views: Array<[View, string]> = [
  ["Início", "⌂"], ["Lançamentos", "↕"], ["Planejamento", "◎"], ["Contas", "▣"],
  ["Cartões", "▤"], ["Orçamentos", "◫"], ["Metas", "◇"], ["Mais", "•••"],
];
const transactionKinds = [
  ["expense", "Despesa"], ["income", "Receita"], ["card_purchase", "Compra no cartão"],
  ["transfer", "Transferência"], ["card_payment", "Pagamento de fatura"],
] as const;

function moneyInput(cents = 0) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function nextDateForDay(day: number) {
  const now = new Date();
  let date = new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28));
  if (date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) date = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(day, 28));
  return localISODate(date);
}

function draftFromTransaction(item?: Transaction): DraftTransaction {
  return {
    kind: item?.kind ?? "expense",
    status: item?.status ?? "paid",
    description: item?.description ?? "",
    amount: moneyInput(item?.amount_cents),
    categoryId: item?.category_id ?? "",
    accountId: item?.account_id ?? "",
    destinationAccountId: item?.destination_account_id ?? "",
    creditCardId: item?.credit_card_id ?? "",
    occurredOn: item?.occurred_on ?? localISODate(),
    installmentCount: item?.installment_count ?? 1,
    notes: item?.notes ?? "",
  };
}

export function FinanceApp() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [view, setView] = useState<View>("Início");
  const [editor, setEditor] = useState<EditorState>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [installPrompt, setInstallPrompt] = useState<(Event & { prompt(): Promise<void> }) | null>(null);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };
  const refresh = useCallback(async (activeUser: User) => {
    if (!supabase) return;
    setLoading(true);
    try {
      setWorkspace(await loadWorkspace(supabase, activeUser));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar os dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      const active = data.session?.user ?? null;
      setUser(active);
      if (active) void refresh(active); else setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const active = session?.user ?? null;
      setUser(active);
      if (active) void refresh(active); else { setWorkspace(emptyWorkspace); setLoading(false); }
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as Event & { prompt(): Promise<void> }); };
    window.addEventListener("beforeinstallprompt", capture);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);

  async function run(action: () => Promise<unknown>, success: string) {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      await action();
      await refresh(user);
      setEditor(null);
      notify(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível concluir.");
      setLoading(false);
    }
  }

  if (!isSupabaseConfigured || !supabase) return <Setup />;
  if (loading && !user) return <Loading />;
  if (!user) return <Auth />;

  const displayName = workspace.profile?.display_name || user.user_metadata?.display_name || user.email?.split("@")[0] || "você";
  const cycle = cycleIntelligence({
    profile: workspace.profile, accounts: workspace.accounts, cards: workspace.creditCards,
    transactions: workspace.transactions, invoices: workspace.invoices,
    recurrings: workspace.recurrings, goals: workspace.goals,
  });
  const budgets = budgetProgress(workspace.budgets, workspace.categories, workspace.transactions);
  const projections = projectTwelveMonths(workspace.profile, workspace.transactions, workspace.goals, workspace.recurrings);
  const edit = (kind: EditorKind, item?: object) => setEditor({ kind, item: item as Record<string, unknown> | undefined });
  const remove = (table: EntityTable, id: string, label: string) => {
    if (confirm(`Excluir ${label}? Essa alteração será refletida em todo o app.`)) void run(() => deleteEntity(supabase, table, id), `${label} excluído.`);
  };

  return <main className="app-shell">
    <aside className="desktop-sidebar">
      <button className="brand sidebar-brand" onClick={() => setView("Início")}><span className="brand-mark">n</span>navi.</button>
      <nav>{views.map(([label, icon]) => <button key={label} className={view === label ? "active" : ""} onClick={() => setView(label)}><span>{icon}</span>{label}</button>)}</nav>
      <div className="sidebar-foot"><small>Conectado como</small><strong>{displayName}</strong><button onClick={() => void supabase.auth.signOut()}>Sair</button></div>
    </aside>
    <section className="app-content">
      <header className="app-bar">
        <button className="brand mobile-brand" onClick={() => setView("Início")}><span className="brand-mark">n</span>navi.</button>
        <div><strong>{view}</strong><small>{monthLabel(localISODate())}</small></div>
        <div className="top-actions"><button className="install-button" onClick={() => installPrompt ? void installPrompt.prompt() : notify("No iPhone, use Compartilhar → Adicionar à Tela de Início.")}>⇩ Instalar</button><button className="avatar" onClick={() => setView("Mais")}>{displayName.slice(0, 2).toUpperCase()}</button></div>
      </header>
      <div className="page">
        {error && <div className="status-banner warning"><span>!</span>{error}<button onClick={() => setError("")}>×</button></div>}
        {loading && <div className="status-banner syncing"><span>↻</span>Sincronizando todas as telas…</div>}
        {view === "Início" && <Home workspace={workspace} name={displayName} cycle={cycle} budgets={budgets} go={setView} add={() => edit("transaction")} />}
        {view === "Lançamentos" && <Transactions workspace={workspace} add={() => edit("transaction")} edit={(item) => edit("transaction", item)} remove={(id) => void run(() => deleteTransaction(supabase, id), "Lançamento excluído.")} />}
        {view === "Planejamento" && <Planning workspace={workspace} cycle={cycle} projections={projections} edit={edit} remove={remove} />}
        {view === "Contas" && <Accounts workspace={workspace} add={() => edit("account")} edit={(item) => edit("account", item)} remove={remove} />}
        {view === "Cartões" && <Cards workspace={workspace} cycle={cycle} add={() => edit("card")} edit={(item) => edit("card", item)} remove={remove} />}
        {view === "Orçamentos" && <Budgets rows={budgets} recurrings={workspace.recurrings} add={() => edit("budget")} edit={edit} remove={remove} />}
        {view === "Metas" && <Goals workspace={workspace} add={() => edit("goal")} edit={(item) => edit("goal", item)} remove={remove} />}
        {view === "Mais" && <More workspace={workspace} profile={workspace.profile} edit={() => edit("profile", workspace.profile ?? undefined)} install={() => installPrompt ? void installPrompt.prompt() : notify("No iPhone, use Compartilhar → Adicionar à Tela de Início.")} signOut={() => void supabase.auth.signOut()} />}
      </div>
    </section>
    <nav className="bottom-nav">{([["Início", "⌂"], ["Lançamentos", "↕"], ["add", "+"], ["Planejamento", "◎"], ["Mais", "•••"]] as const).map(([label, icon]) =>
      label === "add" ? <button key={label} className="nav-add" onClick={() => edit("transaction")}>{icon}</button> :
        <button key={label} className={`nav-item ${view === label ? "active" : ""}`} onClick={() => setView(label)}><span>{icon}</span>{label}</button>)}</nav>
    {editor && <EditorModal state={editor} workspace={workspace} close={() => setEditor(null)} submit={(table, payload, id, message) =>
      void run(async () => {
        if (table === "transactions") {
          if (id) await updateTransaction(supabase, workspace, editor.item as unknown as Transaction, payload as DraftTransaction);
          else await saveTransaction(supabase, workspace, payload as DraftTransaction);
        } else await upsertEntity(supabase, table, payload as Record<string, unknown>, id);
      }, message)} />}
    {toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
  </main>;
}

type Cycle = ReturnType<typeof cycleIntelligence>;
type BudgetRows = ReturnType<typeof budgetProgress>;
type Edit = (kind: EditorKind, item?: object) => void;
type Remove = (table: EntityTable, id: string, label: string) => void;

function Home({ workspace, name, cycle, budgets, go, add }: { workspace: Workspace; name: string; cycle: Cycle; budgets: BudgetRows; go(view: View): void; add(): void }) {
  const consumption = monthlyConsumption(workspace.transactions);
  const topBudget = [...budgets].sort((a, b) => b.usage - a.usage)[0];
  return <>
    <section className="welcome-row"><div><p className="eyebrow">Olá, {name}</p><h1>Seu dinheiro, mais leve.</h1><p className="subcopy">Tudo conectado até o próximo pagamento da fatura.</p></div><button className="primary-button" onClick={add}>＋ Registrar agora</button></section>
    <section className="dashboard-grid"><div className="left-stack">
      <article className={`panel hero-card ${cycle.shortfall ? "hero-danger" : ""}`}><div className="hero-content">
        <p className="hero-label">Você pode gastar por dia até {shortDate(cycle.dueDate)}</p>
        <div className="hero-amount">{formatBRL(cycle.safePerDay)} <small>/dia</small></div>
        <p className="hero-copy">{cycle.shortfall ? `Atenção: faltam ${formatBRL(cycle.shortfall)} para cobrir os compromissos.` : `${formatBRL(cycle.availableUntilDue)} livres depois de proteger fatura, fixos e metas.`}</p>
        <div className="hero-footer"><span className="date-pill">● {cycle.daysUntilDue} dias até a fatura</span><button className="secondary-button" onClick={() => go("Planejamento")}>Ver cálculo</button></div>
      </div></article>
      <div className="metric-grid">
        <Metric label="Saldo em contas" value={formatBRL(cycle.cash)} note="dinheiro disponível agora" />
        <Metric label="Fatura até dia 8" value={formatBRL(cycle.invoiceDue)} note="compromisso do ciclo" />
        <Metric label="Consumo do mês" value={formatBRL(consumption)} note="compras + despesas − estornos" />
      </div>
      <article className="panel list-card"><Title title="Movimentações recentes" action="Ver tudo" onAction={() => go("Lançamentos")} /><TransactionList items={workspace.transactions.slice(0, 5)} /></article>
    </div><aside className="right-stack">
      <article className="panel cycle-card"><p className="eyebrow">Cálculo conectado</p><h2>Até o vencimento</h2><Breakdown cycle={cycle} /><button className="secondary-button wide-button" onClick={() => go("Planejamento")}>Ajustar planejamento</button></article>
      <article className={`insight-card ${topBudget?.usage > 100 ? "danger-insight" : ""}`}><span className="insight-badge">i</span><p><strong>{topBudget ? `${topBudget.name}: ${topBudget.usage}% usado` : "Inteligência financeira ativa"}</strong><br />{topBudget ? (topBudget.usage > 100 ? `Reduza ${formatBRL(Math.abs(topBudget.remaining))} ou redistribua os limites.` : `${formatBRL(topBudget.remaining)} ainda disponíveis nessa categoria.`) : "Crie orçamentos para eu encontrar vazamentos."}</p></article>
      <article className="panel focus-card"><p className="eyebrow">Parcelamentos</p><h2>{workspace.installmentPlans.filter((item) => item.status === "active").length ? "As próximas parcelas já estão no radar." : "Nenhum parcelamento ativo."}</h2><button className="primary-button" onClick={() => go("Planejamento")}>Ver compromissos</button></article>
    </aside></section>
  </>;
}

function Breakdown({ cycle }: { cycle: Cycle }) {
  return <div className="breakdown">
    <Line label="Saldo atual" value={cycle.cash} positive />
    <Line label="Entradas até a fatura" value={cycle.fixedIncome} positive />
    <Line label="Fatura" value={-cycle.invoiceDue} />
    <Line label="Saídas fixas" value={-cycle.fixedExpenses} />
    <Line label="Metas + planejados" value={-(cycle.protectedGoals + cycle.plannedCash)} />
    <Line label="Livre até o dia 8" value={cycle.availableUntilDue} strong />
  </div>;
}

function Transactions({ workspace, add, edit, remove }: { workspace: Workspace; add(): void; edit(item: Transaction): void; remove(id: string): void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const items = workspace.transactions.filter((item) => (kind === "all" || item.kind === kind) && item.description.toLowerCase().includes(query.toLowerCase()));
  return <PageHead eyebrow="Histórico real" title="Lançamentos" action="Novo lançamento" onAction={add}>
    <div className="toolbar"><input placeholder="Buscar estabelecimento…" value={query} onChange={(event) => setQuery(event.target.value)} /><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">Todos os tipos</option>{transactionKinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
    <article className="panel data-panel"><TransactionList items={items} edit={edit} remove={remove} /></article>
  </PageHead>;
}

function Planning({ workspace, cycle, projections, edit, remove }: { workspace: Workspace; cycle: Cycle; projections: ReturnType<typeof projectTwelveMonths>; edit: Edit; remove: Remove }) {
  const incomes = workspace.recurrings.filter((item) => item.is_active && item.kind === "income");
  const expenses = workspace.recurrings.filter((item) => item.is_active && item.kind === "expense");
  const installments = workspace.installmentPlans.filter((item) => item.status === "active");
  const max = Math.max(...projections.map((item) => Math.max(item.income, item.expenses)), 1);
  return <PageHead eyebrow="Do hoje ao futuro" title="Planejamento financeiro" action="Ajustar distribuição" onAction={() => edit("profile", workspace.profile ?? undefined)}>
    <article className="panel cycle-planning"><div><p className="eyebrow">Próximo marco: {shortDate(cycle.dueDate)}</p><h2>{cycle.shortfall ? `Faltam ${formatBRL(cycle.shortfall)}` : `${formatBRL(cycle.availableUntilDue)} livres`}</h2><p>O cálculo muda automaticamente quando qualquer valor é editado.</p></div><Breakdown cycle={cycle} /></article>
    <div className="fixed-grid">
      <FixedColumn title="Entradas fixas" total={incomes.reduce((sum, item) => sum + item.amount_cents, 0)} items={incomes} add={() => edit("recurring", { kind: "income" })} edit={edit} remove={remove} />
      <FixedColumn title="Saídas fixas" total={expenses.reduce((sum, item) => sum + item.amount_cents, 0)} items={expenses} add={() => edit("recurring", { kind: "expense" })} edit={edit} remove={remove} />
    </div>
    <div className="section-heading spaced"><div><p className="eyebrow">Compras parceladas</p><h2>Compromissos futuros</h2></div><button className="secondary-button" onClick={() => edit("installment")}>Novo parcelamento</button></div>
    <div className="installment-grid">{installments.map((item) => <InstallmentCard key={item.id} item={item} edit={() => edit("installment", item)} remove={() => remove("installment_plans", item.id, "parcelamento")} />)}</div>
    {!installments.length && <Empty text="Nenhum parcelamento ativo. Quando adicionar um, ele aparecerá em toda a projeção." action={() => edit("installment")} />}
    <article className="panel planning-chart"><Title title="Entradas e compromissos projetados" /><div className="chart-legend"><span><i className="income-dot" />Entradas</span><span><i className="expense-dot" />Saídas</span></div><div className="bars">{projections.map((item) => <div className="bar-month" key={item.month}><div className="bar-pair"><i className="bar-income" style={{ height: `${Math.max(4, item.income / max * 100)}%` }} /><i className="bar-expense" style={{ height: `${Math.max(4, item.expenses / max * 100)}%` }} /></div><small>{item.month.slice(5)}</small></div>)}</div></article>
    <article className="panel data-panel"><Title title="Visão mensal conectada" /><div className="table-scroll"><table><thead><tr><th>Mês</th><th>Entradas</th><th>Compromissos</th><th>Metas</th><th>Saldo projetado</th></tr></thead><tbody>{projections.map((item) => <tr key={item.month}><td>{monthLabel(item.month)}</td><td className="positive">{formatBRL(item.income)}</td><td>{formatBRL(item.expenses)}</td><td>{formatBRL(item.goalsContribution)}</td><td className={item.projectedBalance >= 0 ? "positive" : "negative"}>{formatBRL(item.projectedBalance)}</td></tr>)}</tbody></table></div></article>
  </PageHead>;
}

function FixedColumn({ title, total, items, add, edit, remove }: { title: string; total: number; items: RecurringTemplate[]; add(): void; edit: Edit; remove: Remove }) {
  return <article className="panel fixed-panel"><Title title={title} action="Adicionar" onAction={add} /><strong className="fixed-total">{formatBRL(total)}<small>/mês</small></strong>{items.map((item) => <div className="editable-row" key={item.id}><span>{item.kind === "income" ? "↗" : "↘"}</span><div><strong>{item.description}</strong><small>Dia {item.day_of_month ?? shortDate(item.next_due_on)}</small></div><b>{formatBRL(item.amount_cents)}</b><RowButtons edit={() => edit("recurring", item)} remove={() => remove("recurring_templates", item.id, item.description)} /></div>)}</article>;
}

function InstallmentCard({ item, edit, remove }: { item: InstallmentPlan; edit(): void; remove(): void }) {
  const current = item.current_installment || 1;
  const remaining = Math.max(0, item.installment_count - current + 1);
  return <article className="panel installment-card"><div className="installment-top"><span className="installment-icon">▤</span><div><small>Parcela {current} de {item.installment_count}</small><h3>{item.description}</h3></div><RowButtons edit={edit} remove={remove} /></div><strong>{formatBRL(item.installment_cents)}<small>/mês</small></strong><div className="progress-track"><div className="progress-bar" style={{ width: `${percent(current, item.installment_count)}%` }} /></div><p>{remaining} parcela(s) · {formatBRL(remaining * item.installment_cents)} ainda comprometidos</p></article>;
}

function Accounts({ workspace, add, edit, remove }: { workspace: Workspace; add(): void; edit(item: Account): void; remove: Remove }) {
  return <PageHead eyebrow="Dinheiro disponível" title="Contas" action="Nova conta" onAction={add}><div className="entity-grid">{workspace.accounts.map((account) => <article className="panel entity-card" key={account.id}><span className="entity-icon" style={{ background: account.color }}>▣</span><div className="entity-body"><small>{account.institution || account.type}</small><h2>{account.name}</h2><strong>{formatBRL(totalAccountBalance([account], workspace.transactions))}</strong><p>Saldo-base em {shortDate(account.balance_as_of)}</p></div><RowButtons edit={() => edit(account)} remove={() => remove("accounts", account.id, account.name)} /></article>)}</div>{!workspace.accounts.length && <Empty text="Cadastre sua primeira conta para calcular o saldo real." action={add} />}</PageHead>;
}

function Cards({ workspace, cycle, add, edit, remove }: { workspace: Workspace; cycle: Cycle; add(): void; edit(item: CreditCard): void; remove: Remove }) {
  return <PageHead eyebrow="Fatura no dia 8" title="Cartões e faturas" action="Novo cartão" onAction={add}>
    <div className="metric-grid"><Metric label="Próximo vencimento" value={shortDate(cycle.dueDate)} note={`${cycle.daysUntilDue} dias restantes`} /><Metric label="Total a pagar" value={formatBRL(cycle.invoiceDue)} note="até o próximo vencimento" /><Metric label="Livre após a fatura" value={formatBRL(cycle.availableUntilDue)} note="inclui entradas e fixos" /></div>
    <div className="entity-grid spaced">{workspace.creditCards.map((card) => { const invoices = workspace.invoices.filter((item) => item.credit_card_id === card.id); return <article className="panel card-entity" key={card.id}><div className="credit-card" style={{ background: card.color }}><small>{card.institution || "Navi"}</small><strong>{card.name}</strong><span>•••• {card.last_four || "••••"}</span></div><div className="card-meta"><span>Vence dia {card.due_day}</span><strong>{formatBRL(invoices.filter((item) => item.status !== "paid").reduce((sum, item) => sum + item.total_cents, 0))} em aberto</strong></div><div className="card-actions"><button className="secondary-button" onClick={() => edit(card)}>Editar cartão</button><button className="ghost-danger" onClick={() => remove("credit_cards", card.id, card.name)}>Excluir</button></div></article>; })}</div>
    <article className="panel data-panel"><Title title="Faturas" /><div className="table-scroll"><table><thead><tr><th>Referência</th><th>Vencimento</th><th>Total</th><th>Status</th></tr></thead><tbody>{workspace.invoices.map((invoice) => <tr key={invoice.id}><td>{monthLabel(invoice.reference_month)}</td><td>{shortDate(invoice.due_date)}</td><td>{formatBRL(invoice.total_cents)}</td><td><span className={`status ${invoice.status}`}>{invoice.status === "paid" ? "Paga" : invoice.status === "closed" ? "Fechada" : "Aberta"}</span></td></tr>)}</tbody></table></div></article>
  </PageHead>;
}

function Budgets({ rows, recurrings, add, edit, remove }: { rows: BudgetRows; recurrings: RecurringTemplate[]; add(): void; edit: Edit; remove: Remove }) {
  const total = rows.reduce((sum, item) => sum + item.limit_cents, 0);
  return <PageHead eyebrow="Distribuição editável" title="Orçamentos" action="Novo orçamento" onAction={add}>
    <div className="budget-grid">{rows.map((row) => <article className="panel budget-card" key={row.id}><div className="panel-title-row"><h2 className="panel-title">{row.name}</h2><RowButtons edit={() => edit("budget", row)} remove={() => remove("budgets", row.id, `orçamento de ${row.name}`)} /></div><strong>{formatBRL(row.spent)} <small>de {formatBRL(row.limit_cents)}</small></strong><div className="progress-track"><div className={`progress-bar ${row.usage > 100 ? "over" : ""}`} style={{ width: `${Math.min(100, row.usage)}%` }} /></div><p className={row.remaining < 0 ? "negative" : "muted"}>{row.remaining >= 0 ? `${formatBRL(row.remaining)} restantes` : `${formatBRL(Math.abs(row.remaining))} acima do limite`} · {total ? percent(row.limit_cents, total) : 0}% da distribuição</p></article>)}</div>
    <div className="section-heading spaced"><div><p className="eyebrow">Automação</p><h2>Entradas e saídas fixas</h2></div><button className="secondary-button" onClick={() => edit("recurring")}>Nova recorrência</button></div>
    <article className="panel data-panel">{recurrings.map((item) => <div className="editable-row" key={item.id}><span>{item.kind === "income" ? "↗" : "↘"}</span><div><strong>{item.description}</strong><small>{item.frequency === "monthly" ? `Todo mês · dia ${item.day_of_month}` : item.frequency}</small></div><b>{formatBRL(item.amount_cents)}</b><RowButtons edit={() => edit("recurring", item)} remove={() => remove("recurring_templates", item.id, item.description)} /></div>)}</article>
  </PageHead>;
}

function Goals({ workspace, add, edit, remove }: { workspace: Workspace; add(): void; edit(item: Goal): void; remove: Remove }) {
  return <PageHead eyebrow="Jornada" title="Metas" action="Nova meta" onAction={add}><div className="goals-grid">{workspace.goals.map((goal) => { const progress = percent(goal.saved_cents, goal.target_cents); return <article className="panel goal-card" key={goal.id}><div className="goal-cover" style={{ background: goal.color }}><strong>{goal.title}</strong></div><div className="goal-caption"><strong>{formatBRL(goal.saved_cents)} de {formatBRL(goal.target_cents)}</strong><span>{progress}%</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${progress}%` }} /></div><p className="muted">{goal.protected ? `${formatBRL(goal.monthly_contribution_cents)} protegidos por mês` : "Meta não protegida no cálculo"}</p><div className="card-actions"><button className="secondary-button" onClick={() => edit(goal)}>Editar</button><button className="ghost-danger" onClick={() => remove("goals", goal.id, goal.title)}>Excluir</button></div></article>; })}</div>{!workspace.goals.length && <Empty text="Crie uma meta para proteger dinheiro antes de gastar." action={add} />}</PageHead>;
}

function More({ workspace, profile, edit, install, signOut }: { workspace: Workspace; profile: Profile | null; edit(): void; install(): void; signOut(): void }) {
  const downloadCSV = () => {
    const blob = new Blob([transactionsToCSV(workspace)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "navi-lancamentos.csv"; link.click(); URL.revokeObjectURL(url);
  };
  return <PageHead eyebrow="Controle e portabilidade" title="Mais"><div className="settings-grid">
    <article className="panel settings-card highlight"><span>◎</span><div><h2>Preferências financeiras</h2><p>Renda-base, dia de entrada, reserva e distribuição.</p></div><button className="secondary-button" onClick={edit}>Editar</button></article>
    <article className="panel settings-card"><span>↗</span><div><h2>Renda-base</h2><p>{formatBRL(profile?.monthly_income_cents ?? 0)} · entrada no dia {profile?.income_day ?? 5}</p></div><button className="secondary-button" onClick={edit}>Ajustar</button></article>
    <article className="panel settings-card"><span>⇩</span><div><h2>Backup completo</h2><p>Baixe seus dados em JSON.</p></div><button className="secondary-button" onClick={() => downloadBackup(workspace)}>Baixar JSON</button></article>
    <article className="panel settings-card"><span>▦</span><div><h2>Exportar lançamentos</h2><p>CSV compatível com planilhas.</p></div><button className="secondary-button" onClick={downloadCSV}>Baixar CSV</button></article>
    <article className="panel settings-card"><span>⌂</span><div><h2>Instalar aplicativo</h2><p>Use o Navi como app.</p></div><button className="secondary-button" onClick={install}>Instalar PWA</button></article>
    <article className="panel settings-card"><span>◌</span><div><h2>Privacidade</h2><p>Dados separados por usuário no Supabase.</p></div><button className="secondary-button" onClick={signOut}>Sair da conta</button></article>
  </div></PageHead>;
}

function EditorModal({ state, workspace, close, submit }: {
  state: NonNullable<EditorState>; workspace: Workspace; close(): void;
  submit(table: EntityTable | "transactions", payload: DraftTransaction | Record<string, unknown>, id: string | undefined, message: string): void;
}) {
  const item = state.item ?? {};
  const id = item.id as string | undefined;
  const [draft, setDraft] = useState(() => draftFromTransaction(state.kind === "transaction" ? item as unknown as Transaction : undefined));
  const titles: Record<EditorKind, string> = {
    transaction: id ? "Editar lançamento" : "Novo lançamento",
    profile: "Preferências financeiras", account: id ? "Editar conta" : "Nova conta",
    card: id ? "Editar cartão" : "Novo cartão", budget: id ? "Editar orçamento" : "Novo orçamento",
    recurring: id ? "Editar valor fixo" : "Novo valor fixo", installment: id ? "Editar parcelamento" : "Novo parcelamento",
    goal: id ? "Editar meta" : "Nova meta",
  };
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    if (state.kind === "transaction") {
      submit("transactions", { ...draft, categoryId: draft.categoryId || workspace.categories[0]?.id || "", accountId: draft.accountId || workspace.accounts[0]?.id || "" }, id, id ? "Lançamento atualizado." : "Lançamento salvo."); return;
    }
    if (state.kind === "profile") submit("profiles", { display_name: value("name"), monthly_income_cents: parseBRL(value("income")), fixed_costs_cents: parseBRL(value("fixed")), income_day: Number(value("day")), reserve_percent: Number(value("reserve")) }, id, "Preferências atualizadas.");
    if (state.kind === "account") submit("accounts", { name: value("name"), institution: value("institution") || null, type: value("type"), initial_balance_cents: parseBRL(value("amount")), balance_as_of: value("date"), color: value("color"), icon: "wallet", is_active: true }, id, "Conta salva.");
    if (state.kind === "card") submit("credit_cards", { name: value("name"), institution: value("institution") || null, account_id: value("account_id") || null, limit_cents: parseBRL(value("amount")), due_day: Number(value("day")), closing_day: value("closing") ? Number(value("closing")) : null, color: value("color"), is_active: true }, id, "Cartão salvo.");
    if (state.kind === "budget") submit("budgets", { category_id: value("category_id"), reference_month: monthStart(), limit_cents: parseBRL(value("amount")), allocation_percent: Number(value("allocation")) || null }, id, "Orçamento salvo.");
    if (state.kind === "recurring") {
      const day = Number(value("day"));
      submit("recurring_templates", { kind: value("kind"), description: value("name"), amount_cents: parseBRL(value("amount")), category_id: value("category_id") || null, account_id: value("account_id") || null, frequency: value("frequency"), day_of_month: day, starts_on: (item.starts_on as string) || localISODate(), next_due_on: nextDateForDay(day), is_active: true, is_fixed: true, notes: value("notes") || null }, id, "Valor fixo salvo.");
    }
    if (state.kind === "installment") submit("installment_plans", { credit_card_id: value("card_id") || null, description: value("name"), total_cents: parseBRL(value("total")), installment_cents: parseBRL(value("amount")), installment_count: Number(value("count")), current_installment: Number(value("current")), due_day: Number(value("day")) || 8, first_installment_on: value("date"), status: value("status"), notes: value("notes") || null }, id, "Parcelamento salvo.");
    if (state.kind === "goal") submit("goals", { title: value("name"), target_cents: parseBRL(value("amount")), saved_cents: parseBRL(value("saved")), target_date: value("date") || null, monthly_contribution_cents: parseBRL(value("monthly")), protected: form.get("protected") === "on", status: value("status"), color: value("color"), notes: value("notes") || null }, id, "Meta salva.");
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><form className="modal" onSubmit={handle}>
    <div className="modal-header"><div><h2>{titles[state.kind]}</h2><p>Ao salvar, todas as telas serão recalculadas.</p></div><button type="button" className="close-button" onClick={close}>×</button></div>
    {state.kind === "transaction" ? <TransactionFields draft={draft} setDraft={setDraft} workspace={workspace} editing={Boolean(id)} /> : <EntityFields kind={state.kind} item={item} workspace={workspace} />}
    <div className="form-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button className="primary-button">Salvar e recalcular</button></div>
  </form></div>;
}

function TransactionFields({ draft, setDraft, workspace, editing }: { draft: DraftTransaction; setDraft(value: DraftTransaction): void; workspace: Workspace; editing: boolean }) {
  return <div className="form-grid">
    <Field label="Tipo"><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as DraftTransaction["kind"] })}>{transactionKinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
    <Field label="Status"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as DraftTransaction["status"] })}><option value="paid">Confirmado</option><option value="planned">Planejado</option><option value="pending">Pendente</option><option value="cancelled">Cancelado</option></select></Field>
    <Field label="Descrição"><input required value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
    <Field label="Valor"><input required inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></Field>
    <Field label="Categoria"><select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">Selecione</option>{workspace.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field>
    {draft.kind === "card_purchase" ? <><Field label="Cartão"><select required value={draft.creditCardId} onChange={(event) => setDraft({ ...draft, creditCardId: event.target.value })}><option value="">Selecione</option>{workspace.creditCards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}</select></Field>{!editing && <Field label="Parcelas"><input type="number" min="1" max="60" value={draft.installmentCount} onChange={(event) => setDraft({ ...draft, installmentCount: Number(event.target.value) })} /></Field>}</> : <Field label="Conta"><select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}><option value="">Selecione</option>{workspace.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></Field>}
    {draft.kind === "transfer" && <Field label="Conta de destino"><select value={draft.destinationAccountId} onChange={(event) => setDraft({ ...draft, destinationAccountId: event.target.value })}><option value="">Selecione</option>{workspace.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></Field>}
    <Field label="Data"><input type="date" value={draft.occurredOn} onChange={(event) => setDraft({ ...draft, occurredOn: event.target.value })} /></Field>
    <Field label="Observação"><input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
  </div>;
}

function EntityFields({ kind, item, workspace }: { kind: Exclude<EditorKind, "transaction">; item: Record<string, unknown>; workspace: Workspace }) {
  if (kind === "profile") return <div className="form-grid"><Field label="Seu nome"><input name="name" defaultValue={item.display_name as string} /></Field><Field label="Renda-base mensal"><input name="income" inputMode="decimal" defaultValue={moneyInput(item.monthly_income_cents as number)} /></Field><Field label="Custos fixos-base"><input name="fixed" inputMode="decimal" defaultValue={moneyInput(item.fixed_costs_cents as number)} /></Field><Field label="Dia principal de entrada"><input name="day" type="number" min="1" max="31" defaultValue={(item.income_day as number) || 5} /></Field><Field label="% de reserva"><input name="reserve" type="number" min="0" max="100" step="0.1" defaultValue={(item.reserve_percent as number) || 0} /></Field></div>;
  if (kind === "account") return <div className="form-grid"><Field label="Nome"><input name="name" required defaultValue={item.name as string} /></Field><Field label="Instituição"><input name="institution" defaultValue={item.institution as string} /></Field><Field label="Tipo"><select name="type" defaultValue={(item.type as string) || "checking"}><option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="cash">Dinheiro</option><option value="investment">Investimento</option><option value="other">Outro</option></select></Field><Field label="Saldo-base"><input name="amount" inputMode="decimal" defaultValue={moneyInput(item.initial_balance_cents as number)} /></Field><Field label="Data do saldo-base"><input name="date" type="date" defaultValue={(item.balance_as_of as string) || localISODate()} /></Field><Field label="Cor"><input name="color" type="color" defaultValue={(item.color as string) || "#0b6cf0"} /></Field></div>;
  if (kind === "card") return <div className="form-grid"><Field label="Nome do cartão"><input name="name" required defaultValue={item.name as string} /></Field><Field label="Instituição"><input name="institution" defaultValue={item.institution as string} /></Field><Field label="Conta de pagamento"><select name="account_id" defaultValue={(item.account_id as string) || ""}><option value="">Nenhuma</option>{workspace.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></Field><Field label="Limite"><input name="amount" inputMode="decimal" defaultValue={moneyInput(item.limit_cents as number)} /></Field><Field label="Dia de vencimento"><input name="day" type="number" min="1" max="31" defaultValue={(item.due_day as number) || 8} /></Field><Field label="Dia de fechamento"><input name="closing" type="number" min="1" max="31" defaultValue={(item.closing_day as number) || ""} /></Field><Field label="Cor"><input name="color" type="color" defaultValue={(item.color as string) || "#111827"} /></Field></div>;
  if (kind === "budget") return <div className="form-grid"><Field label="Categoria"><select name="category_id" defaultValue={item.category_id as string}>{workspace.categories.filter((category) => category.kind !== "income").map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></Field><Field label="Limite mensal"><input name="amount" inputMode="decimal" defaultValue={moneyInput(item.limit_cents as number)} /></Field><Field label="% da distribuição (opcional)"><input name="allocation" type="number" min="0" max="100" step="0.1" defaultValue={(item.allocation_percent as number) || ""} /></Field></div>;
  if (kind === "recurring") return <div className="form-grid"><Field label="Tipo"><select name="kind" defaultValue={(item.kind as string) || "expense"}><option value="expense">Saída fixa</option><option value="income">Entrada fixa</option></select></Field><Field label="Descrição"><input name="name" required defaultValue={item.description as string} /></Field><Field label="Valor"><input name="amount" inputMode="decimal" defaultValue={moneyInput(item.amount_cents as number)} /></Field><Field label="Conta"><select name="account_id" defaultValue={(item.account_id as string) || ""}><option value="">Nenhuma</option>{workspace.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></Field><Field label="Categoria"><select name="category_id" defaultValue={(item.category_id as string) || ""}><option value="">Sem categoria</option>{workspace.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></Field><Field label="Frequência"><select name="frequency" defaultValue={(item.frequency as string) || "monthly"}><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></Field><Field label="Dia"><input name="day" type="number" min="1" max="31" defaultValue={(item.day_of_month as number) || 8} /></Field><Field label="Observação"><input name="notes" defaultValue={item.notes as string} /></Field></div>;
  if (kind === "installment") return <div className="form-grid"><Field label="Descrição"><input name="name" required defaultValue={item.description as string} /></Field><Field label="Cartão"><select name="card_id" defaultValue={(item.credit_card_id as string) || ""}><option value="">Nenhum</option>{workspace.creditCards.map((card) => <option value={card.id} key={card.id}>{card.name}</option>)}</select></Field><Field label="Valor total"><input name="total" inputMode="decimal" defaultValue={moneyInput(item.total_cents as number)} /></Field><Field label="Valor da parcela"><input name="amount" inputMode="decimal" defaultValue={moneyInput(item.installment_cents as number)} /></Field><Field label="Total de parcelas"><input name="count" type="number" min="2" max="120" defaultValue={(item.installment_count as number) || 2} /></Field><Field label="Parcela atual"><input name="current" type="number" min="1" max="120" defaultValue={(item.current_installment as number) || 1} /></Field><Field label="Dia de vencimento"><input name="day" type="number" min="1" max="31" defaultValue={(item.due_day as number) || 8} /></Field><Field label="Primeira parcela"><input name="date" type="date" defaultValue={(item.first_installment_on as string) || localISODate()} /></Field><Field label="Status"><select name="status" defaultValue={(item.status as string) || "active"}><option value="active">Ativo</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></Field><Field label="Observação"><input name="notes" defaultValue={item.notes as string} /></Field></div>;
  return <div className="form-grid"><Field label="Nome"><input name="name" required defaultValue={item.title as string} /></Field><Field label="Valor da meta"><input name="amount" inputMode="decimal" defaultValue={moneyInput(item.target_cents as number)} /></Field><Field label="Já guardado"><input name="saved" inputMode="decimal" defaultValue={moneyInput(item.saved_cents as number)} /></Field><Field label="Guardar por mês"><input name="monthly" inputMode="decimal" defaultValue={moneyInput(item.monthly_contribution_cents as number)} /></Field><Field label="Data alvo"><input name="date" type="date" defaultValue={item.target_date as string} /></Field><Field label="Status"><select name="status" defaultValue={(item.status as string) || "active"}><option value="active">Ativa</option><option value="paused">Pausada</option><option value="completed">Concluída</option><option value="cancelled">Cancelada</option></select></Field><label className="check-field"><input name="protected" type="checkbox" defaultChecked={(item.protected as boolean) ?? true} /> Proteger este valor no cálculo</label><Field label="Cor"><input name="color" type="color" defaultValue={(item.color as string) || "#0b6cf0"} /></Field><Field label="Observação"><input name="notes" defaultValue={item.notes as string} /></Field></div>;
}

function TransactionList({ items, edit, remove }: { items: Transaction[]; edit?(item: Transaction): void; remove?(id: string): void }) {
  if (!items.length) return <Empty text="Nenhum lançamento encontrado." />;
  return <div className="transaction-list">{items.map((item) => <div className="transaction" key={item.id}><span className="transaction-icon">{item.kind === "income" ? "↗" : item.kind === "refund" ? "↩" : item.kind === "card_purchase" ? "▤" : item.kind === "card_payment" ? "✓" : "↘"}</span><div className="transaction-info"><strong>{item.description}</strong><span>{shortDate(item.occurred_on)} · {item.category}{item.installment_count ? ` · ${item.installment_number}/${item.installment_count}` : ""}</span></div><span className={`transaction-value ${item.kind === "income" || item.kind === "refund" ? "income" : ""}`}>{item.kind === "income" || item.kind === "refund" ? "+" : item.kind === "card_payment" ? "" : "−"} {formatBRL(item.amount_cents)}</span>{edit && remove && <RowButtons edit={() => edit(item)} remove={() => confirm("Excluir este lançamento?") && remove(item.id)} />}</div>)}</div>;
}

function RowButtons({ edit, remove }: { edit(): void; remove(): void }) { return <div className="row-buttons"><button title="Editar" onClick={edit}>✎</button><button className="delete" title="Excluir" onClick={remove}>×</button></div>; }
function Line({ label, value, positive, strong }: { label: string; value: number; positive?: boolean; strong?: boolean }) { return <div className={`breakdown-line ${strong ? "total" : ""}`}><span>{label}</span><b className={value < 0 ? "negative" : positive ? "positive" : ""}>{value > 0 && positive ? "+" : ""}{formatBRL(value)}</b></div>; }
function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article className="panel metric-card"><small>{label}</small><strong>{value}</strong><span>{note}</span></article>; }
function Title({ title, action, onAction }: { title: string; action?: string; onAction?(): void }) { return <div className="panel-title-row"><h2 className="panel-title">{title}</h2>{action && <button className="text-button" onClick={onAction}>{action} →</button>}</div>; }
function PageHead({ eyebrow, title, action, onAction, children }: { eyebrow: string; title: string; action?: string; onAction?(): void; children: React.ReactNode }) { return <><section className="section-heading page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>{action && <button className="primary-button" onClick={onAction}>＋ {action}</button>}</section>{children}</>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Empty({ text, action }: { text: string; action?(): void }) { return <div className="empty-state"><span>◇</span><strong>{text}</strong>{action && <button className="secondary-button" onClick={action}>Começar agora</button>}</div>; }
function Loading() { return <main className="loading-screen"><div className="loading-mark">n</div><p>Organizando seu dinheiro…</p></main>; }
function Setup() { return <main className="auth-layout"><section className="auth-card"><div className="brand"><span className="brand-mark">n</span>navi.</div><h1>Falta conectar o Supabase.</h1><p className="subcopy">Configure as variáveis públicas do projeto para ativar o app.</p></section></main>; }

function Auth() {
  const [signup, setSignup] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; const form = new FormData(event.currentTarget); setBusy(true); setMessage("");
    const email = String(form.get("email")); const password = String(form.get("password")); const name = String(form.get("name") || "");
    const result = signup ? await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } }) : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false); if (result.error) setMessage(result.error.message); else if (signup && !result.data.session) setMessage("Conta criada. Confirme o e-mail para entrar.");
  }
  return <main className="auth-layout"><section className="auth-card"><div className="brand"><span className="brand-mark">n</span>navi.</div><p className="eyebrow">Seu dinheiro, seu espaço</p><h1>{signup ? "Crie sua conta." : "Que bom ter você de volta."}</h1><p className="subcopy">Seus dados ficam separados e protegidos por usuário.</p><form className="form-grid" onSubmit={submit}>{signup && <Field label="Nome"><input name="name" required /></Field>}<Field label="E-mail"><input name="email" type="email" required /></Field><Field label="Senha"><input name="password" type="password" minLength={6} required /></Field>{message && <p className="form-error">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? "Aguarde…" : signup ? "Criar conta" : "Entrar"}</button></form><p className="auth-note">{signup ? "Já tem conta?" : "Ainda não tem conta?"} <button className="text-button" onClick={() => setSignup(!signup)}>{signup ? "Entrar" : "Criar agora"}</button></p></section></main>;
}
