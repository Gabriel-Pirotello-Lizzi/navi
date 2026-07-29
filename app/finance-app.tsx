import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { DraftTransaction, Goal, Workspace } from "@/src/domain/types";
import { availableToday, budgetProgress, monthlyConsumption, projectTwelveMonths, totalAccountBalance } from "@/src/services/calculation-service";
import { localISODate, monthLabel, monthStart, shortDate } from "@/src/services/dates";
import { downloadBackup, transactionsToCSV } from "@/src/services/backup-service";
import { formatBRL, parseBRL, percent } from "@/src/services/money";
import { contributeToGoal, deleteTransaction, loadWorkspace, saveEntity, saveGoal, saveTransaction } from "@/src/services/finance-repository";

type View = "Início" | "Lançamentos" | "Planejamento" | "Contas" | "Cartões" | "Orçamentos" | "Metas" | "Mais";
type Modal = "transaction" | "account" | "card" | "budget" | "goal" | "recurring" | null;
const emptyWorkspace: Workspace = { profile: null, accounts: [], creditCards: [], categories: [], transactions: [], invoices: [], installmentPlans: [], recurrings: [], budgets: [], goals: [] };
const views: Array<[View, string]> = [["Início", "⌂"], ["Lançamentos", "↕"], ["Planejamento", "◎"], ["Contas", "▣"], ["Cartões", "▤"], ["Orçamentos", "◫"], ["Metas", "◇"], ["Mais", "•••"]];
const transactionKinds = [
  ["expense", "Despesa"], ["income", "Receita"], ["card_purchase", "Compra no cartão"], ["transfer", "Transferência"], ["card_payment", "Pagamento de fatura"],
] as const;

function defaultDraft(): DraftTransaction {
  return { kind: "expense", status: "paid", description: "", amount: "", categoryId: "", accountId: "", destinationAccountId: "", creditCardId: "", occurredOn: localISODate(), installmentCount: 1, notes: "" };
}

export function FinanceApp() {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [view, setView] = useState<View>("Início");
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [installPrompt, setInstallPrompt] = useState<Event & { prompt(): Promise<void> } | null>(null);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  const refresh = useCallback(async (activeUser: User) => {
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const loaded = await loadWorkspace(supabase, activeUser);
      setWorkspace(loaded);
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
    try { await action(); await refresh(user); setModal(null); notify(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível concluir."); setLoading(false); }
  }

  if (!isSupabaseConfigured || !supabase) return <Setup />;
  if (loading && !user) return <Loading />;
  if (!user) return <Auth />;

  const profile = workspace.profile;
  const displayName = profile?.display_name || user.user_metadata?.display_name || user.email?.split("@")[0] || "você";
  const plan = availableToday({ profile, accounts: workspace.accounts, transactions: workspace.transactions, invoices: workspace.invoices, goals: workspace.goals });
  const consumption = monthlyConsumption(workspace.transactions);
  const budgetRows = budgetProgress(workspace.budgets, workspace.categories, workspace.transactions);
  const projections = projectTwelveMonths(profile, workspace.transactions, workspace.goals);

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
        {loading && <div className="status-banner syncing"><span>↻</span>Sincronizando seus dados…</div>}
        {view === "Início" && <Home workspace={workspace} name={displayName} plan={plan} consumption={consumption} openTransaction={() => setModal("transaction")} go={setView} />}
        {view === "Lançamentos" && <Transactions workspace={workspace} open={() => setModal("transaction")} remove={(id) => run(() => deleteTransaction(supabase, id), "Lançamento excluído.")} />}
        {view === "Planejamento" && <Planning projections={projections} workspace={workspace} />}
        {view === "Contas" && <Accounts workspace={workspace} open={() => setModal("account")} />}
        {view === "Cartões" && <Cards workspace={workspace} open={() => setModal("card")} />}
        {view === "Orçamentos" && <Budgets rows={budgetRows} recurrings={workspace.recurrings} openBudget={() => setModal("budget")} openRecurring={() => setModal("recurring")} />}
        {view === "Metas" && <Goals workspace={workspace} open={() => setModal("goal")} contribute={(goal, cents) => run(() => contributeToGoal(supabase, goal, cents, workspace.accounts[0]?.id ?? null), "Valor guardado na meta.")} />}
        {view === "Mais" && <More workspace={workspace} install={() => installPrompt ? void installPrompt.prompt() : notify("No iPhone, use Compartilhar → Adicionar à Tela de Início.")} signOut={() => void supabase.auth.signOut()} />}
      </div>
    </section>
    <nav className="bottom-nav">{([["Início", "⌂"], ["Lançamentos", "↕"], ["add", "+"], ["Planejamento", "◎"], ["Mais", "•••"]] as const).map(([label, icon]) =>
      label === "add" ? <button key={label} className="nav-add" onClick={() => setModal("transaction")}>{icon}</button> :
      <button key={label} className={`nav-item ${view === label ? "active" : ""}`} onClick={() => setView(label)}><span>{icon}</span>{label}</button>)}</nav>
    {modal && <EditorModal kind={modal} workspace={workspace} close={() => setModal(null)} submit={(table, payload, message) => run(() =>
      table === "transactions" ? saveTransaction(supabase, workspace, payload as DraftTransaction) :
      table === "goals" ? saveGoal(supabase, payload as Partial<Goal>) :
      saveEntity(supabase, table, payload as Record<string, unknown>), message)} />}
    {toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
  </main>;
}

function Home({ workspace, name, plan, consumption, openTransaction, go }: {
  workspace: Workspace; name: string; plan: ReturnType<typeof availableToday>; consumption: number; openTransaction(): void; go(view: View): void;
}) {
  const recent = workspace.transactions.slice(0, 5);
  return <>
    <section className="welcome-row"><div><p className="eyebrow">Olá, {name}</p><h1>Seu dinheiro, mais leve.</h1><p className="subcopy">Saldo, compromissos e escolhas sem misturar os conceitos.</p></div><button className="primary-button" onClick={openTransaction}>＋ Registrar agora</button></section>
    <section className="dashboard-grid"><div className="left-stack">
      <article className="panel hero-card"><div className="hero-content"><p className="hero-label">Disponível hoje</p><div className="hero-amount">{formatBRL(plan.availableToday)} <small>/dia</small></div><p className="hero-copy">Valor livre após proteger faturas, compromissos planejados e metas.</p><div className="hero-footer"><span className="date-pill">● {plan.daysLeft} dias no mês</span><button className="secondary-button" onClick={() => go("Planejamento")}>Ver cálculo</button></div></div></article>
      <div className="metric-grid">
        <Metric label="Saldo em contas" value={formatBRL(plan.cash)} note="dinheiro disponível" />
        <Metric label="Dívida nos cartões" value={formatBRL(plan.debt)} note="não reduz o saldo até pagar" />
        <Metric label="Consumo do mês" value={formatBRL(consumption)} note="compras + despesas − estornos" />
      </div>
      <article className="panel list-card"><Title title="Movimentações recentes" action="Ver tudo" onAction={() => go("Lançamentos")} /><TransactionList items={recent} /></article>
    </div><aside className="right-stack">
      <article className="panel focus-card"><p className="eyebrow">Próximo passo</p><h2>{workspace.goals.length ? "Continue protegendo o que importa." : "Dê um destino ao seu dinheiro."}</h2><button className="primary-button" onClick={() => go("Metas")}>Ver metas</button></article>
      <article className="panel summary-card"><Title title="Faturas" action="Abrir" onAction={() => go("Cartões")} />{workspace.invoices.slice(0, 3).map((item) => <div className="summary-line" key={item.id}><span>{monthLabel(item.reference_month)}</span><strong>{formatBRL(item.total_cents)}</strong><small className={`status ${item.status}`}>{item.status === "paid" ? "paga" : item.status === "closed" ? "fechada" : "aberta"}</small></div>)}</article>
      <article className="insight-card"><span className="insight-badge">i</span><p><strong>Sem dupla contagem.</strong><br />Pagar a fatura reduz a conta, mas não vira um segundo gasto.</p></article>
    </aside></section>
  </>;
}

function Transactions({ workspace, open, remove }: { workspace: Workspace; open(): void; remove(id: string): void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const items = workspace.transactions.filter((item) => (kind === "all" || item.kind === kind) && item.description.toLowerCase().includes(query.toLowerCase()));
  return <PageHead eyebrow="Histórico real" title="Lançamentos" action="Novo lançamento" onAction={open}>
    <div className="toolbar"><input placeholder="Buscar estabelecimento…" value={query} onChange={(e) => setQuery(e.target.value)} /><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">Todos os tipos</option>{transactionKinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
    <article className="panel data-panel"><TransactionList items={items} remove={remove} /></article>
  </PageHead>;
}

function Planning({ projections, workspace }: { projections: ReturnType<typeof projectTwelveMonths>; workspace: Workspace }) {
  const max = Math.max(...projections.map((item) => Math.max(item.income, item.expenses)), 1);
  return <PageHead eyebrow="12 meses" title="Planejamento financeiro">
    <div className="metric-grid"><Metric label="Saldo consolidado" value={formatBRL(totalAccountBalance(workspace.accounts, workspace.transactions))} note="todas as contas" /><Metric label="Parcelamentos" value={String(workspace.installmentPlans.filter((x) => x.status === "active").length)} note="planos ativos" /><Metric label="Recorrências" value={String(workspace.recurrings.filter((x) => x.is_active).length)} note="itens ativos" /></div>
    <article className="panel planning-chart"><Title title="Entradas e compromissos projetados" /><div className="chart-legend"><span><i className="income-dot" />Entradas</span><span><i className="expense-dot" />Saídas</span></div><div className="bars">{projections.map((item) => <div className="bar-month" key={item.month}><div className="bar-pair"><i className="bar-income" style={{ height: `${Math.max(4, item.income / max * 100)}%` }} /><i className="bar-expense" style={{ height: `${Math.max(4, item.expenses / max * 100)}%` }} /></div><small>{item.month.slice(5)}</small></div>)}</div></article>
    <article className="panel data-panel"><Title title="Visão mensal" /><div className="table-scroll"><table><thead><tr><th>Mês</th><th>Entradas</th><th>Consumo</th><th>Metas</th><th>Saldo projetado</th></tr></thead><tbody>{projections.map((item) => <tr key={item.month}><td>{monthLabel(item.month)}</td><td className="positive">{formatBRL(item.income)}</td><td>{formatBRL(item.expenses)}</td><td>{formatBRL(item.goalsContribution)}</td><td className={item.projectedBalance >= 0 ? "positive" : "negative"}>{formatBRL(item.projectedBalance)}</td></tr>)}</tbody></table></div></article>
  </PageHead>;
}

function Accounts({ workspace, open }: { workspace: Workspace; open(): void }) {
  return <PageHead eyebrow="Dinheiro disponível" title="Contas" action="Nova conta" onAction={open}><div className="entity-grid">{workspace.accounts.map((account) => <article className="panel entity-card" key={account.id}><span className="entity-icon" style={{ background: account.color }}>▣</span><div><small>{account.institution || account.type}</small><h2>{account.name}</h2><strong>{formatBRL(totalAccountBalance([account], workspace.transactions))}</strong><p>Saldo informado em {shortDate(account.balance_as_of)}</p></div></article>)}</div>{!workspace.accounts.length && <Empty text="Cadastre sua primeira conta para calcular o saldo real." action={open} />}</PageHead>;
}

function Cards({ workspace, open }: { workspace: Workspace; open(): void }) {
  return <PageHead eyebrow="Dívidas e vencimentos" title="Cartões e faturas" action="Novo cartão" onAction={open}><div className="entity-grid">{workspace.creditCards.map((card) => { const invoices = workspace.invoices.filter((i) => i.credit_card_id === card.id); return <article className="panel card-entity" key={card.id}><div className="credit-card" style={{ background: card.color }}><small>{card.institution || "Navi"}</small><strong>{card.name}</strong><span>•••• {card.last_four || "••••"}</span></div><div className="card-meta"><span>Vence dia {card.due_day}</span><strong>{formatBRL(invoices.filter(i => i.status !== "paid").reduce((sum, i) => sum + i.total_cents, 0))} em aberto</strong></div></article>})}</div><article className="panel data-panel"><Title title="Faturas importadas" /><div className="table-scroll"><table><thead><tr><th>Referência</th><th>Vencimento</th><th>Total</th><th>Status</th></tr></thead><tbody>{workspace.invoices.map((invoice) => <tr key={invoice.id}><td>{monthLabel(invoice.reference_month)}</td><td>{shortDate(invoice.due_date)}</td><td>{formatBRL(invoice.total_cents)}</td><td><span className={`status ${invoice.status}`}>{invoice.status === "paid" ? "Paga" : invoice.status === "closed" ? "Fechada" : "Aberta"}</span></td></tr>)}</tbody></table></div></article></PageHead>;
}

function Budgets({ rows, recurrings, openBudget, openRecurring }: { rows: ReturnType<typeof budgetProgress>; recurrings: Workspace["recurrings"]; openBudget(): void; openRecurring(): void }) {
  return <PageHead eyebrow="Limites honestos" title="Orçamentos" action="Novo orçamento" onAction={openBudget}><div className="budget-grid">{rows.map((row) => <article className="panel budget-card" key={row.id}><Title title={row.name} /><strong>{formatBRL(row.spent)} <small>de {formatBRL(row.limit_cents)}</small></strong><div className="progress-track"><div className={`progress-bar ${row.usage > 100 ? "over" : ""}`} style={{ width: `${Math.min(100, row.usage)}%` }} /></div><p className={row.remaining < 0 ? "negative" : "muted"}>{row.remaining >= 0 ? `${formatBRL(row.remaining)} restantes` : `${formatBRL(Math.abs(row.remaining))} acima do limite`}</p></article>)}</div><div className="section-heading spaced"><div><p className="eyebrow">Automação</p><h2>Recorrências</h2></div><button className="secondary-button" onClick={openRecurring}>Nova recorrência</button></div><article className="panel data-panel">{recurrings.map((item) => <div className="recurring-row" key={item.id}><span>{item.kind === "income" ? "↗" : "↘"}</span><div><strong>{item.description}</strong><small>Todo mês · próximo dia {shortDate(item.next_due_on)}</small></div><b>{formatBRL(item.amount_cents)}</b></div>)}</article></PageHead>;
}

function Goals({ workspace, open, contribute }: { workspace: Workspace; open(): void; contribute(goal: Goal, cents: number): void }) {
  return <PageHead eyebrow="Jornada" title="Metas" action="Nova meta" onAction={open}><div className="goals-grid">{workspace.goals.map((goal) => { const progress = percent(goal.saved_cents, goal.target_cents); return <article className="panel goal-card" key={goal.id}><div className="goal-cover" style={{ background: goal.color }}><strong>{goal.title}</strong></div><div className="goal-caption"><strong>{formatBRL(goal.saved_cents)} de {formatBRL(goal.target_cents)}</strong><span>{progress}%</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${progress}%` }} /></div><p className="muted">{goal.status === "completed" ? "Meta concluída" : goal.target_date ? `Alvo: ${shortDate(goal.target_date)}` : "Sem data alvo"}</p>{goal.status !== "completed" && <button className="secondary-button wide-button" onClick={() => { const value = prompt("Quanto deseja guardar?"); const cents = parseBRL(value || ""); if (cents > 0) contribute(goal, cents); }}>Guardar agora</button>}</article>})}</div>{!workspace.goals.length && <Empty text="Crie uma meta para proteger dinheiro antes de gastar." action={open} />}</PageHead>;
}

function More({ workspace, install, signOut }: { workspace: Workspace; install(): void; signOut(): void }) {
  const downloadCSV = () => { const blob = new Blob([transactionsToCSV(workspace)], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "navi-lancamentos.csv"; a.click(); URL.revokeObjectURL(url); };
  return <PageHead eyebrow="Controle e portabilidade" title="Mais"><div className="settings-grid">
    <article className="panel settings-card"><span>⇩</span><div><h2>Backup completo</h2><p>Baixe seus dados em JSON para guardar ou restaurar depois.</p></div><button className="secondary-button" onClick={() => downloadBackup(workspace)}>Baixar JSON</button></article>
    <article className="panel settings-card"><span>▦</span><div><h2>Exportar lançamentos</h2><p>Arquivo CSV compatível com planilhas.</p></div><button className="secondary-button" onClick={downloadCSV}>Baixar CSV</button></article>
    <article className="panel settings-card"><span>⌂</span><div><h2>Instalar aplicativo</h2><p>Use o Navi como app no celular ou computador.</p></div><button className="secondary-button" onClick={install}>Instalar PWA</button></article>
    <article className="panel settings-card"><span>◌</span><div><h2>Privacidade</h2><p>Dados separados por usuário com regras de acesso no Supabase.</p></div><button className="secondary-button" onClick={signOut}>Sair da conta</button></article>
  </div></PageHead>;
}

function EditorModal({ kind, workspace, close, submit }: { kind: NonNullable<Modal>; workspace: Workspace; close(): void; submit(table: "transactions" | "accounts" | "credit_cards" | "budgets" | "recurring_templates" | "goals", payload: DraftTransaction | Record<string, unknown>, message: string): void }) {
  const [draft, setDraft] = useState(defaultDraft);
  const title = { transaction: "Novo lançamento", account: "Nova conta", card: "Novo cartão", budget: "Novo orçamento", goal: "Nova meta", recurring: "Nova recorrência" }[kind];
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (kind === "transaction") { submit("transactions", { ...draft, categoryId: draft.categoryId || workspace.categories[0]?.id || "", accountId: draft.accountId || workspace.accounts[0]?.id || "" }, "Lançamento salvo."); return; }
    if (kind === "account") submit("accounts", { name: form.get("name"), type: form.get("type"), initial_balance_cents: parseBRL(String(form.get("amount"))), balance_as_of: localISODate(), color: "#0b6cf0", icon: "wallet" }, "Conta criada.");
    if (kind === "card") submit("credit_cards", { name: form.get("name"), account_id: form.get("account_id") || null, limit_cents: parseBRL(String(form.get("amount"))), due_day: Number(form.get("day")), closing_day: form.get("closing") ? Number(form.get("closing")) : null, color: "#111827" }, "Cartão criado.");
    if (kind === "budget") submit("budgets", { category_id: form.get("category_id"), reference_month: monthStart(), limit_cents: parseBRL(String(form.get("amount"))) }, "Orçamento criado.");
    if (kind === "goal") submit("goals", { title: form.get("name"), target_cents: parseBRL(String(form.get("amount"))), saved_cents: 0, target_date: form.get("date") || null, monthly_contribution_cents: parseBRL(String(form.get("monthly"))), protected: true, color: "#0b6cf0" }, "Meta criada.");
    if (kind === "recurring") submit("recurring_templates", { kind: form.get("recurring_kind"), description: form.get("name"), amount_cents: parseBRL(String(form.get("amount"))), category_id: form.get("category_id") || null, account_id: form.get("account_id") || null, frequency: "monthly", day_of_month: Number(form.get("day")), starts_on: localISODate(), next_due_on: localISODate() }, "Recorrência criada.");
  }
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><form className="modal" onSubmit={handle}><div className="modal-header"><div><h2>{title}</h2><p>Os dados serão salvos na sua conta.</p></div><button type="button" className="close-button" onClick={close}>×</button></div>
    {kind === "transaction" ? <div className="form-grid"><Field label="Tipo"><select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DraftTransaction["kind"] })}>{transactionKinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="Descrição"><input required value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field><Field label="Valor"><input required inputMode="decimal" placeholder="0,00" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></Field><Field label="Categoria"><select value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}><option value="">Selecione</option>{workspace.categories.filter(c => c.kind !== "income").map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>{draft.kind === "card_purchase" ? <><Field label="Cartão"><select required value={draft.creditCardId} onChange={(e) => setDraft({ ...draft, creditCardId: e.target.value })}><option value="">Selecione</option>{workspace.creditCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field><Field label="Parcelas"><input type="number" min="1" max="60" value={draft.installmentCount} onChange={(e) => setDraft({ ...draft, installmentCount: Number(e.target.value) })} /></Field></> : <Field label={draft.kind === "transfer" ? "Conta de origem" : "Conta"}><select value={draft.accountId} onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}><option value="">Selecione</option>{workspace.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}{draft.kind === "transfer" && <Field label="Conta de destino"><select value={draft.destinationAccountId} onChange={(e) => setDraft({ ...draft, destinationAccountId: e.target.value })}><option value="">Selecione</option>{workspace.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}<Field label="Data"><input type="date" value={draft.occurredOn} onChange={(e) => setDraft({ ...draft, occurredOn: e.target.value })} /></Field></div> :
    <div className="form-grid"><Field label={kind === "card" ? "Nome do cartão" : kind === "budget" ? "Categoria" : "Nome"}>{kind === "budget" ? <select name="category_id" required>{workspace.categories.filter(c => c.kind !== "income").map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select> : <input name="name" required />}</Field>{kind === "account" && <Field label="Tipo"><select name="type"><option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="cash">Dinheiro</option><option value="investment">Investimento</option><option value="other">Outro</option></select></Field>}{(kind === "card" || kind === "recurring") && <Field label="Conta"><select name="account_id"><option value="">Nenhuma</option>{workspace.accounts.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></Field>}{kind === "recurring" && <><Field label="Tipo"><select name="recurring_kind"><option value="expense">Despesa</option><option value="income">Receita</option></select></Field><Field label="Categoria"><select name="category_id">{workspace.categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></Field></>}<Field label={kind === "account" ? "Saldo atual" : kind === "goal" ? "Valor da meta" : kind === "card" ? "Limite (opcional)" : "Valor"}><input name="amount" required={kind !== "card"} inputMode="decimal" placeholder="0,00" /></Field>{kind === "card" && <><Field label="Dia de vencimento"><input name="day" type="number" min="1" max="31" required /></Field><Field label="Dia de fechamento (opcional)"><input name="closing" type="number" min="1" max="31" /></Field></>}{kind === "goal" && <><Field label="Guardar por mês"><input name="monthly" inputMode="decimal" placeholder="0,00" /></Field><Field label="Data alvo"><input name="date" type="date" /></Field></>}{kind === "recurring" && <Field label="Dia do mês"><input name="day" type="number" min="1" max="31" required /></Field>}</div>}
    <div className="form-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button className="primary-button">Salvar</button></div></form></div>;
}

function TransactionList({ items, remove }: { items: Workspace["transactions"]; remove?(id: string): void }) {
  if (!items.length) return <Empty text="Nenhum lançamento encontrado." />;
  return <div className="transaction-list">{items.map((item) => <div className="transaction" key={item.id}><span className="transaction-icon">{item.kind === "income" ? "↗" : item.kind === "refund" ? "↩" : item.kind === "card_purchase" ? "▤" : item.kind === "card_payment" ? "✓" : "↘"}</span><div className="transaction-info"><strong>{item.description}</strong><span>{shortDate(item.occurred_on)} · {item.category}{item.installment_count ? ` · ${item.installment_number}/${item.installment_count}` : ""}</span></div><span className={`transaction-value ${item.kind === "income" || item.kind === "refund" ? "income" : ""}`}>{item.kind === "income" || item.kind === "refund" ? "+" : item.kind === "card_payment" ? "" : "−"} {formatBRL(item.amount_cents)}</span>{remove && <button className="row-action" onClick={() => confirm("Excluir este lançamento?") && remove(item.id)}>×</button>}</div>)}</div>;
}
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
