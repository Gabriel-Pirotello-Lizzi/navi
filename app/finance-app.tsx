"use client";

import type { User } from "@supabase/supabase-js";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  calculatePlan,
  categories,
  categoryVisuals,
  moneyFromCents,
  parseMoneyToCents,
  profileDisplayName,
  type Goal,
  type PendingTransaction,
  type Profile,
  type Transaction,
  type TransactionKind,
} from "@/lib/finance";
import { readOfflineCache, readPendingTransactions, writeOfflineCache, writePendingTransactions } from "@/lib/offline-store";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type Screen = "loading" | "setup" | "auth" | "onboarding" | "dashboard";
type Modal = "transaction" | "goal" | null;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const emptyProfile: Profile = {
  id: "",
  display_name: null,
  monthly_income_cents: 0,
  fixed_costs_cents: 0,
  income_day: 5,
  onboarding_completed: false,
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(`${value}T12:00:00`));
}

function newRequestId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function FinanceApp() {
  const [screen, setScreen] = useState<Screen>(() => (!isSupabaseConfigured || !supabase ? "setup" : "loading"));
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [activeTab, setActiveTab] = useState("Hoje");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [incomeInput, setIncomeInput] = useState("");
  const [fixedInput, setFixedInput] = useState("");
  const [transactionDraft, setTransactionDraft] = useState({ description: "", amount: "", category: "Mercado", kind: "expense" as TransactionKind });
  const [goalDraft, setGoalDraft] = useState({ title: "", amount: "", date: "" });

  const displayName = profileDisplayName(profile, user?.user_metadata?.display_name ?? user?.email?.split("@")[0] ?? "");
  const plan = useMemo(() => calculatePlan(profile ?? emptyProfile, transactions), [profile, transactions]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const loadWorkspace = useCallback(async (activeUser: User) => {
    if (!supabase) return;
    setSyncing(true);
    setError("");
    try {
      const [profileResult, transactionsResult, goalsResult] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", activeUser.id).maybeSingle(),
        supabase.from("transactions").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("goals").select("*").order("created_at", { ascending: false }),
      ]);
      if (profileResult.error || transactionsResult.error || goalsResult.error) throw new Error("Não foi possível carregar seus dados.");
      const loadedProfile = profileResult.data as Profile | null;
      const loadedTransactions = (transactionsResult.data ?? []) as Transaction[];
      const loadedGoals = (goalsResult.data ?? []) as Goal[];
      setProfile(loadedProfile);
      setTransactions(loadedTransactions);
      setGoals(loadedGoals);
      writeOfflineCache({ profile: loadedProfile, transactions: loadedTransactions, goals: loadedGoals });
      setIncomeInput(loadedProfile?.monthly_income_cents ? String(loadedProfile.monthly_income_cents / 100).replace(".", ",") : "");
      setFixedInput(loadedProfile?.fixed_costs_cents ? String(loadedProfile.fixed_costs_cents / 100).replace(".", ",") : "");
      setScreen(loadedProfile?.onboarding_completed ? "dashboard" : "onboarding");
    } catch (loadError) {
      const cached = readOfflineCache();
      if (cached.profile) {
        setProfile(cached.profile);
        setTransactions(cached.transactions);
        setGoals(cached.goals);
        setScreen(cached.profile.onboarding_completed ? "dashboard" : "onboarding");
        setError("Você está vendo os últimos dados sincronizados. Novos lançamentos serão enviados quando a conexão voltar.");
      } else {
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar seus dados.");
        setScreen("onboarding");
      }
    } finally {
      setSyncing(false);
    }
  }, []);

  const syncPending = useCallback(async (activeUser: User) => {
    if (!supabase || !navigator.onLine) return;
    const pending = readPendingTransactions();
    if (!pending.length) return;
    setSyncing(true);
    const remaining: PendingTransaction[] = [];
    for (const queued of pending) {
      const payload = {
        kind: queued.kind,
        amount_cents: queued.amount_cents,
        description: queued.description,
        category: queued.category,
        occurred_on: queued.occurred_on,
      };
      const { error: insertError } = await supabase.from("transactions").insert(payload);
      if (insertError) remaining.push(queued);
    }
    writePendingTransactions(remaining);
    if (remaining.length === 0) {
      notify("Lançamentos offline sincronizados.");
      await loadWorkspace(activeUser);
    }
    setSyncing(false);
  }, [loadWorkspace, notify]);

  useEffect(() => {
    const captureInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const goOnline = () => { setOnline(true); if (user) void syncPending(user); };
    const goOffline = () => setOnline(false);
    window.addEventListener("beforeinstallprompt", captureInstall);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstall);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [syncPending, user]);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const activeUser = data.session?.user ?? null;
      setUser(activeUser);
      if (activeUser) void loadWorkspace(activeUser); else setScreen("auth");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const activeUser = session?.user ?? null;
      setUser(activeUser);
      if (activeUser) void loadWorkspace(activeUser); else setScreen("auth");
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [loadWorkspace]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    setAuthBusy(true);
    setError("");
    const result = authMode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } });
    setAuthBusy(false);
    if (result.error) { setError(result.error.message); return; }
    if (authMode === "signup" && !result.data.session) setError("Conta criada. Confira seu e-mail para confirmar o acesso.");
  }

  async function finishOnboarding() {
    if (!supabase || !user) return;
    const monthlyIncome = parseMoneyToCents(incomeInput);
    const fixedCosts = parseMoneyToCents(fixedInput);
    if (!monthlyIncome) { setError("Informe sua renda mensal para continuar."); return; }
    setSyncing(true);
    const payload = {
      id: user.id,
      display_name: user.user_metadata?.display_name ?? null,
      monthly_income_cents: monthlyIncome,
      fixed_costs_cents: fixedCosts,
      income_day: 5,
      onboarding_completed: true,
    };
    const { data, error: saveError } = await supabase.from("profiles").upsert(payload).select().single();
    setSyncing(false);
    if (saveError) { setError(saveError.message); return; }
    setProfile(data as Profile);
    writeOfflineCache({ profile: data as Profile, transactions, goals });
    setScreen("dashboard");
    notify("Seu plano está pronto. Vamos cuidar dele um dia por vez.");
  }

  async function saveTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = parseMoneyToCents(transactionDraft.amount);
    const description = transactionDraft.description.trim();
    if (!description || !amountCents) { setError("Escreva uma descrição e informe um valor válido."); return; }
    const requestId = newRequestId();
    const payload = {
      kind: transactionDraft.kind,
      amount_cents: amountCents,
      description,
      category: transactionDraft.kind === "income" ? "Renda" : transactionDraft.category,
      occurred_on: today(),
    };
    const localTransaction: Transaction = { id: `local-${requestId}`, ...payload, created_at: new Date().toISOString(), pending: true };
    setTransactions((items) => [localTransaction, ...items]);
    setModal(null);
    setTransactionDraft({ description: "", amount: "", category: "Mercado", kind: "expense" });
    setError("");
    if (!supabase || !navigator.onLine) {
      writePendingTransactions([...readPendingTransactions(), { requestId, ...payload }]);
      notify("Sem internet: lançamento guardado para sincronizar.");
      return;
    }
    const { data, error: saveError } = await supabase.from("transactions").insert(payload).select().single();
    if (saveError) {
      writePendingTransactions([...readPendingTransactions(), { requestId, ...payload }]);
      notify("Lançamento guardado localmente; vou tentar sincronizar depois.");
      return;
    }
    setTransactions((items) => [data as Transaction, ...items.filter((item) => item.id !== localTransaction.id)]);
    notify(transactionDraft.kind === "income" ? "Entrada salva." : "Gasto salvo. Seu limite de hoje foi atualizado.");
  }

  async function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const targetCents = parseMoneyToCents(goalDraft.amount);
    if (!goalDraft.title.trim() || !targetCents) { setError("Dê um nome e um valor à sua meta."); return; }
    const { data, error: saveError } = await supabase.from("goals").insert({ title: goalDraft.title.trim(), target_cents: targetCents, target_date: goalDraft.date || null }).select().single();
    if (saveError) { setError(saveError.message); return; }
    setGoals((items) => [data as Goal, ...items]);
    setGoalDraft({ title: "", amount: "", date: "" });
    setModal(null);
    notify("Meta criada. Cada escolha agora pode te aproximar dela.");
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setTransactions([]); setGoals([]); setProfile(null); setUser(null); setScreen("auth");
  }

  async function installApp() {
    if (!installPrompt) { notify("No iPhone, toque em Compartilhar e escolha “Adicionar à Tela de Início”."); return; }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  }

  if (screen === "loading") return <main className="loading-screen"><div className="loading-mark">n</div><p>Preparando sua navegação financeira…</p></main>;
  if (screen === "setup") return <SetupScreen />;
  if (screen === "auth") return <AuthScreen authMode={authMode} setAuthMode={setAuthMode} onSubmit={handleAuth} busy={authBusy} error={error} />;
  if (screen === "onboarding") return <OnboardingScreen step={onboardingStep} setStep={setOnboardingStep} income={incomeInput} setIncome={setIncomeInput} fixed={fixedInput} setFixed={setFixedInput} onFinish={finishOnboarding} error={error} />;

  return (
    <main className="app-shell">
      <header className="app-bar">
        <button className="brand" aria-label="Navi, página inicial" onClick={() => setActiveTab("Hoje")}><span className="brand-mark">n</span>navi.</button>
        <div className="top-actions">
          <button className="install-button" onClick={installApp}>⇩ Instalar</button>
          <button className="avatar" aria-label="Ajustar perfil" onClick={() => { setOnboardingStep(2); setScreen("onboarding"); }}>{displayName.slice(0, 2).toUpperCase()}</button>
        </div>
      </header>
      <div className="page">
        {!online && <div className="status-banner offline"><span>●</span> Você está offline. Os lançamentos ficam guardados e sincronizam assim que a conexão voltar.</div>}
        {online && syncing && <div className="status-banner syncing"><span>↻</span> Sincronizando seus dados…</div>}
        {error && <div className="status-banner warning"><span>!</span>{error}</div>}
        <section className="welcome-row"><div><p className="eyebrow">Bom dia, {displayName}</p><h1>Seu dinheiro está no rumo.</h1><p className="subcopy">Hoje é um bom dia para escolher com calma.</p></div><button className="primary-button" onClick={() => setModal("transaction")}>＋ Registrar agora</button></section>
        <section className="dashboard-grid">
          <div className="left-stack">
            <article className="panel hero-card"><div className="hero-content"><p className="hero-label">Disponível hoje</p><div className="hero-amount">{moneyFromCents(plan.availableToday)} <small>/dia</small></div><p className="hero-copy">Esse é o valor livre para hoje depois das contas fixas e dos lançamentos deste mês.</p><div className="hero-footer"><span className="date-pill">● {plan.daysLeft} dias restantes neste mês</span><button className="secondary-button" onClick={() => { setOnboardingStep(2); setScreen("onboarding"); }}>Ajustar plano</button></div></div></article>
            <article className="panel monthly-card"><div className="panel-title-row"><h2 className="panel-title">Este mês</h2><button className="text-button" onClick={() => setActiveTab("Gastos")}>Ver gastos →</button></div><div className="month-progress-number"><strong>{plan.usage}%</strong><span>do orçamento livre usado</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${plan.usage}%` }} /></div><div className="month-meta"><span><strong>{moneyFromCents(plan.expenses)}</strong> usados</span><span>{moneyFromCents(Math.max(0, plan.monthlyBudget - plan.expenses))} restantes</span></div></article>
            <article className="panel list-card"><div className="panel-title-row"><h2 className="panel-title">Movimentações recentes</h2><button className="text-button" onClick={() => setModal("transaction")}>Adicionar</button></div><TransactionList transactions={transactions.slice(0, 5)} emptyAction={() => setModal("transaction")} /></article>
          </div>
          <aside className="right-stack">
            <article className="panel focus-card"><p className="eyebrow">Seu próximo passo</p><h2>{goals.length ? "Proteger sua meta antes de qualquer impulso." : "Crie uma meta que faça o dinheiro ganhar direção."}</h2><button className="primary-button" onClick={() => setModal("goal")}>{goals.length ? "Ver e criar metas" : "Criar minha meta"}</button></article>
            <GoalCard goal={goals[0]} openGoal={() => setModal("goal")} />
            <article className="insight-card"><span className="insight-badge">✦</span><p><strong>Seu controle é seu.</strong><br />Os dados são isolados por conta e você pode usar o app mesmo sem conexão.</p></article>
          </aside>
        </section>
        {activeTab === "Gastos" && <section className="detail-section"><div className="section-heading"><div><p className="eyebrow">Histórico real</p><h2>Todos os lançamentos</h2></div><button className="secondary-button" onClick={() => setModal("transaction")}>Novo lançamento</button></div><article className="panel full-transactions"><TransactionList transactions={transactions} emptyAction={() => setModal("transaction")} /></article></section>}
        {activeTab === "Metas" && <section className="detail-section"><div className="section-heading"><div><p className="eyebrow">Jornada</p><h2>Suas metas</h2></div><button className="secondary-button" onClick={() => setModal("goal")}>Criar meta</button></div><div className="goals-grid">{goals.length ? goals.map((goal) => <GoalCard key={goal.id} goal={goal} openGoal={() => setModal("goal")} />) : <GoalCard openGoal={() => setModal("goal")} />}</div></section>}
      </div>
      <nav className="bottom-nav" aria-label="Navegação principal">{[["Hoje", "◷"], ["Gastos", "▥"], ["Metas", "◎"]].map(([label, icon]) => <button key={label} className={`nav-item ${activeTab === label ? "active" : ""}`} onClick={() => setActiveTab(label)}><span>{icon}</span>{label}</button>)}<button className="nav-item" onClick={signOut}><span>◌</span>Sair</button></nav>
      {modal === "transaction" && <TransactionModal draft={transactionDraft} setDraft={setTransactionDraft} close={() => setModal(null)} submit={saveTransaction} />}
      {modal === "goal" && <GoalModal draft={goalDraft} setDraft={setGoalDraft} close={() => setModal(null)} submit={saveGoal} />}
      {toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>}
    </main>
  );
}

function SetupScreen() {
  return <main className="auth-layout"><section className="auth-card setup-card"><div className="brand"><span className="brand-mark">n</span>navi.</div><p className="eyebrow">Conexão necessária</p><h1>Falta conectar o seu Supabase.</h1><p className="subcopy">O aplicativo está pronto. Adicione a URL e a chave anon pública do projeto no arquivo <code>.env.local</code> para ativar cadastro, dados e sincronização.</p><div className="setup-code">VITE_NAVI_SUPABASE_URL=…<br />VITE_NAVI_SUPABASE_ANON_KEY=…</div><p className="auth-note">Essas chaves são públicas do cliente. Nunca coloque uma chave <em>service_role</em> no aplicativo.</p></section></main>;
}

function AuthScreen({ authMode, setAuthMode, onSubmit, busy, error }: { authMode: "login" | "signup"; setAuthMode: (mode: "login" | "signup") => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; error: string }) {
  return <main className="auth-layout"><section className="auth-card"><div className="brand"><span className="brand-mark">n</span>navi.</div><p className="eyebrow">Seu dinheiro, seu espaço</p><h1>{authMode === "login" ? "Que bom ter você de volta." : "Vamos organizar sua vida financeira."}</h1><p className="subcopy">{authMode === "login" ? "Entre para ver os dados que só pertencem a você." : "Crie sua conta. Leva menos de um minuto."}</p><form className="form-grid auth-form" onSubmit={onSubmit}>{authMode === "signup" && <div className="field"><label htmlFor="name">Como podemos te chamar?</label><input id="name" name="name" required placeholder="Seu nome" /></div>}<div className="field"><label htmlFor="email">E-mail</label><input id="email" name="email" type="email" required placeholder="voce@email.com" /></div><div className="field"><label htmlFor="password">Senha</label><input id="password" name="password" type="password" required minLength={6} placeholder="Mínimo de 6 caracteres" /></div>{error && <p className="form-error">{error}</p>}<button className="primary-button auth-submit" disabled={busy}>{busy ? "Aguarde…" : authMode === "login" ? "Entrar" : "Criar conta"}</button></form><p className="auth-note">{authMode === "login" ? "Ainda não tem conta?" : "Já tem conta?"} <button className="text-button" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>{authMode === "login" ? "Criar agora" : "Entrar"}</button></p></section></main>;
}

function OnboardingScreen({ step, setStep, income, setIncome, fixed, setFixed, onFinish, error }: { step: number; setStep: (value: number) => void; income: string; setIncome: (value: string) => void; fixed: string; setFixed: (value: string) => void; onFinish: () => void; error: string }) {
  const questions = [
    ["Pergunta rápida", "Você já organiza o seu dinheiro hoje?", ["🫠 Nem um pouco, é um caos", "🙂 Mais ou menos, tento mas falho", "😎 Sim, mas posso melhorar"]],
    ["Quero te entender", "Dinheiro costuma ser uma preocupação no seu dia a dia?", ["😰 Toda hora, tira meu sono", "😬 Às vezes, bate ansiedade", "😌 Raramente, tá tranquilo"]],
  ] as const;
  if (step < 2) { const current = questions[step]; return <main className="onboarding"><div className="onboarding-frame"><div className="onboarding-top"><button className="back-button" onClick={() => setStep(Math.max(0, step - 1))}>← Voltar</button><span className="step-count">{step + 1} de 3</span></div><section className="onboarding-card"><p className="eyebrow">{current[0]}</p><h1>{current[1]}</h1><p className="subcopy">Vou usar isso apenas para adaptar a forma como explico seu plano.</p><div className="choices">{current[2].map((choice) => <button key={choice} className="choice-button" onClick={() => setStep(step + 1)}><span className="choice-emoji">{choice.slice(0, 2)}</span>{choice.slice(3)}</button>)}</div></section></div></main>; }
  return <main className="onboarding"><div className="onboarding-frame"><div className="onboarding-top"><button className="back-button" onClick={() => setStep(1)}>← Voltar</button><span className="step-count">seu plano</span></div><section className="onboarding-card"><p className="eyebrow">Agora, seus números</p><h1>Quanto entra e quanto já tem destino?</h1><p className="subcopy">Esses valores ficam protegidos antes de eu calcular o que pode ser gasto no dia.</p><div className="form-grid onboarding-form"><div className="field"><label htmlFor="income">Renda mensal</label><div className="money-field"><span>R$</span><input id="income" inputMode="decimal" placeholder="0,00" value={income} onChange={(event) => setIncome(event.target.value)} /></div></div><div className="field"><label htmlFor="fixed">Contas fixas mensais</label><div className="money-field"><span>R$</span><input id="fixed" inputMode="decimal" placeholder="0,00" value={fixed} onChange={(event) => setFixed(event.target.value)} /></div></div>{error && <p className="form-error">{error}</p>}<button className="primary-button onboarding-finish" onClick={onFinish}>Ver meu plano →</button></div></section></div></main>;
}

function TransactionList({ transactions, emptyAction }: { transactions: Transaction[]; emptyAction: () => void }) {
  if (!transactions.length) return <div className="empty-state"><span>◎</span><strong>Ainda não tem lançamentos.</strong><p>Registre o primeiro gasto ou entrada para a navi calcular seu dia.</p><button className="secondary-button" onClick={emptyAction}>Registrar agora</button></div>;
  return <div className="transaction-list">{transactions.map((item) => { const visual = categoryVisuals[item.category] ?? categoryVisuals.Outros; return <div key={item.id} className="transaction"><span className="transaction-icon" style={{ background: visual.tone }}>{visual.icon}</span><div className="transaction-info"><strong>{item.description}</strong><span>{item.id.startsWith("local-") ? "Aguardando conexão" : shortDate(item.occurred_on)} · {item.category}</span></div><span className={`transaction-value ${item.kind}`}>{item.kind === "income" ? "+" : "−"} {moneyFromCents(item.amount_cents)} {item.pending && <small>•</small>}</span></div>; })}</div>;
}

function GoalCard({ goal, openGoal }: { goal?: Goal; openGoal: () => void }) {
  if (!goal) return <article className="panel goal-card empty-goal"><div className="goal-cover"><strong>Um objetivo muda a rota.</strong></div><div className="goal-caption"><strong>Sem meta por enquanto</strong><span>comece aqui</span></div><p className="goal-helper">Pode ser uma reserva, uma viagem ou quitar algo que está pesando.</p><button className="secondary-button wide-button" onClick={openGoal}>Criar minha meta</button></article>;
  const percentage = Math.min(100, Math.round((goal.saved_cents / goal.target_cents) * 100));
  return <article className="panel goal-card"><div className="goal-cover"><strong>{goal.title}</strong></div><div className="goal-caption"><strong>{moneyFromCents(goal.saved_cents)} de {moneyFromCents(goal.target_cents)}</strong><span>{percentage}%</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${percentage}%` }} /></div><div className="month-meta"><span>{goal.target_date ? `meta para ${shortDate(goal.target_date)}` : "sem data definida"}</span><button className="text-button" onClick={openGoal}>Nova meta</button></div></article>;
}

function TransactionModal({ draft, setDraft, close, submit }: { draft: { description: string; amount: string; category: string; kind: TransactionKind }; setDraft: (draft: { description: string; amount: string; category: string; kind: TransactionKind }) => void; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><form className="modal" onSubmit={submit}><div className="modal-header"><div><h2>Novo lançamento</h2><p>Registre agora. Se estiver offline, eu envio depois.</p></div><button className="close-button" type="button" aria-label="Fechar" onClick={close}>×</button></div><div className="type-switch"><button type="button" className={draft.kind === "expense" ? "active" : ""} onClick={() => setDraft({ ...draft, kind: "expense" })}>Saída</button><button type="button" className={draft.kind === "income" ? "active" : ""} onClick={() => setDraft({ ...draft, kind: "income" })}>Entrada</button></div><div className="form-grid"><div className="field"><label htmlFor="description">O que foi?</label><input id="description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Ex.: almoço, salário, Uber" autoFocus /></div><div className="field"><label htmlFor="amount">Valor</label><div className="money-field"><span>R$</span><input id="amount" inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="0,00" /></div></div>{draft.kind === "expense" && <div className="field"><label htmlFor="category">Categoria</label><select id="category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></div>}</div><div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" type="submit">Salvar lançamento</button></div></form></div>;
}

function GoalModal({ draft, setDraft, close, submit }: { draft: { title: string; amount: string; date: string }; setDraft: (draft: { title: string; amount: string; date: string }) => void; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}><form className="modal" onSubmit={submit}><div className="modal-header"><div><h2>Nova meta</h2><p>Um destino claro deixa as escolhas do mês mais fáceis.</p></div><button className="close-button" type="button" aria-label="Fechar" onClick={close}>×</button></div><div className="form-grid"><div className="field"><label htmlFor="goal-title">Qual é o objetivo?</label><input id="goal-title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ex.: minha reserva" autoFocus /></div><div className="field"><label htmlFor="goal-amount">Quanto quer juntar?</label><div className="money-field"><span>R$</span><input id="goal-amount" inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="0,00" /></div></div><div className="field"><label htmlFor="goal-date">Data alvo (opcional)</label><input id="goal-date" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></div></div><div className="form-actions"><button className="secondary-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" type="submit">Criar meta</button></div></form></div>;
}
