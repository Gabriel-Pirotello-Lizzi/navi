"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type TransactionKind = "expense" | "income";

type Transaction = {
  id: number;
  title: string;
  category: string;
  amount: number;
  kind: TransactionKind;
  icon: string;
  tone: string;
  day: string;
};

type NewTransaction = {
  title: string;
  amount: string;
  category: string;
  kind: TransactionKind;
};

const initialTransactions: Transaction[] = [
  { id: 1, title: "Pão de Açúcar", category: "Mercado", amount: 187.45, kind: "expense", icon: "🛒", tone: "#e8f6ee", day: "Hoje" },
  { id: 2, title: "Uber", category: "Transporte", amount: 28.9, kind: "expense", icon: "🚗", tone: "#e9f2ff", day: "Hoje" },
  { id: 3, title: "Netflix", category: "Assinaturas", amount: 39.9, kind: "expense", icon: "◉", tone: "#f7edff", day: "Ontem" },
  { id: 4, title: "Freela design", category: "Renda extra", amount: 480, kind: "income", icon: "✦", tone: "#e7f8f0", day: "Ontem" },
];

const categoryIcons: Record<string, { icon: string; tone: string }> = {
  Mercado: { icon: "🛒", tone: "#e8f6ee" },
  Transporte: { icon: "🚗", tone: "#e9f2ff" },
  Casa: { icon: "⌂", tone: "#fff2e3" },
  Lazer: { icon: "✦", tone: "#f7edff" },
  Assinaturas: { icon: "◉", tone: "#f7edff" },
  Saúde: { icon: "＋", tone: "#ffecef" },
  Renda: { icon: "↗", tone: "#e7f8f0" },
  Outros: { icon: "•", tone: "#eef1f6" },
};

const onboardingSteps = [
  {
    eyebrow: "Pergunta rápida",
    title: "Você já organiza o seu dinheiro hoje?",
    copy: "Quero entender o seu momento para montar um plano que caiba na sua vida.",
    choices: [
      ["🫠", "Nem um pouco, é um caos"],
      ["😐", "Mais ou menos, tento mas falho"],
      ["🙂", "Sim, mas posso melhorar"],
    ],
  },
  {
    eyebrow: "Quero te entender",
    title: "Dinheiro costuma ser uma preocupação no seu dia a dia?",
    copy: "Sem julgamentos: sua resposta só deixa as orientações mais honestas.",
    choices: [
      ["😰", "Toda hora, tira meu sono"],
      ["😬", "Às vezes, bate ansiedade"],
      ["😎", "Raramente, tá tranquilo"],
    ],
  },
  {
    eyebrow: "Sobre a sua renda",
    title: "Sua renda muda de um mês pro outro?",
    copy: "Isso ajuda a navi a sugerir uma margem de segurança realista.",
    choices: [
      ["😌", "É sempre a mesma"],
      ["🙂", "Muda um pouco"],
      ["😅", "Muda bastante"],
      ["📈", "Muda muito"],
    ],
  },
];

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function monthSpend(transactions: Transaction[]) {
  return transactions
    .filter((item) => item.kind === "expense")
    .reduce((total, item) => total + item.amount, 0);
}

type StoredTransaction = {
  id: number;
  title: string;
  category: string;
  amountCents: number;
  kind: TransactionKind;
  occurredOn: string;
};

function fromStoredTransaction(item: StoredTransaction): Transaction {
  const visual = categoryIcons[item.kind === "income" ? "Renda" : item.category] ?? categoryIcons.Outros;
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    amount: item.amountCents / 100,
    kind: item.kind,
    icon: visual.icon,
    tone: visual.tone,
    day: item.occurredOn === new Date().toISOString().slice(0, 10) ? "Hoje" : "Registrado",
  };
}

export function FinanceApp({ firstName }: { firstName: string }) {
  const [screen, setScreen] = useState<"dashboard" | "onboarding">("dashboard");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [income, setIncome] = useState(8600);
  const [fixedCosts, setFixedCosts] = useState(600);
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState("");
  const [activeTab, setActiveTab] = useState("Hoje");
  const [draft, setDraft] = useState<NewTransaction>({ title: "", amount: "", category: "Mercado", kind: "expense" });

  const spent = useMemo(() => monthSpend(transactions), [transactions]);
  const incomeEntries = useMemo(
    () => transactions.filter((item) => item.kind === "income").reduce((total, item) => total + item.amount, 0),
    [transactions],
  );
  const totalIncome = income + incomeEntries;
  const budget = totalIncome - fixedCosts - 1250;
  const availableToday = Math.max(0, (budget - spent) / 10);
  const usedPercent = Math.min(100, Math.round((spent / Math.max(budget, 1)) * 100));

  useEffect(() => {
    let active = true;

    fetch("/api/transactions")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load transactions");
        return (await response.json()) as { transactions: StoredTransaction[] };
      })
      .then((data) => {
        if (active && data.transactions.length) setTransactions(data.transactions.map(fromStoredTransaction));
      })
      .catch(() => {
        // The sample data remains visible until the first saved transaction is available.
      });

    return () => { active = false; };
  }, []);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function nextOnboarding() {
    if (onboardingStep < onboardingSteps.length - 1) {
      setOnboardingStep((step) => step + 1);
    } else {
      setOnboardingStep(3);
    }
  }

  function finishOnboarding() {
    setScreen("dashboard");
    setOnboardingStep(0);
    showToast("Seu plano inicial está pronto.");
  }

  async function submitTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(draft.amount.replace(",", "."));
    const title = draft.title.trim();
    if (!title || !amount || amount <= 0) {
      showToast("Preencha uma descrição e um valor válido.");
      return;
    }
    const visual = categoryIcons[draft.kind === "income" ? "Renda" : draft.category] ?? categoryIcons.Outros;
    const optimisticId = Date.now();
    const optimisticTransaction: Transaction = {
      id: optimisticId,
      title,
      category: draft.kind === "income" ? "Renda" : draft.category,
      amount,
      kind: draft.kind,
      icon: visual.icon,
      tone: visual.tone,
      day: "Agora",
    };
    setTransactions((items) => [optimisticTransaction, ...items]);
    setDraft({ title: "", amount: "", category: "Mercado", kind: "expense" });
    setShowModal(false);

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          category: optimisticTransaction.category,
          kind: draft.kind,
          amountCents: Math.round(amount * 100),
        }),
      });
      if (!response.ok) throw new Error("Could not save transaction");
      const data = (await response.json()) as { transaction: StoredTransaction };
      setTransactions((items) => [fromStoredTransaction(data.transaction), ...items.filter((item) => item.id !== optimisticId)]);
      showToast(draft.kind === "income" ? "Entrada salva na sua conta." : "Gasto salvo. Seu limite de hoje foi atualizado.");
    } catch {
      setTransactions((items) => items.filter((item) => item.id !== optimisticId));
      showToast("Não consegui salvar agora. Tente novamente em instantes.");
    }
  }

  if (screen === "onboarding") {
    if (onboardingStep === 3) {
      return (
        <main className="onboarding">
          <div className="onboarding-frame">
            <div className="onboarding-top"><button className="back-button" onClick={() => setOnboardingStep(2)}>← Voltar</button><span className="step-count">quase lá</span></div>
            <section className="onboarding-card">
              <p className="eyebrow">Sua renda mensal</p>
              <h1>Quanto você ganha por mês?</h1>
              <p className="subcopy">Com esse valor, eu calculo a sua sobra real e evito metas que só ficam bonitas no papel.</p>
              <div className="onboarding-amount">
                <label className="currency-input"><span>R$</span><input aria-label="Renda mensal" inputMode="decimal" value={income} onChange={(event) => setIncome(Number(event.target.value.replace(/\D/g, "")) || 0)} /></label>
                <button className="primary-button" onClick={() => setOnboardingStep(4)}>Continuar →</button>
              </div>
            </section>
          </div>
        </main>
      );
    }
    if (onboardingStep === 4) {
      return (
        <main className="onboarding">
          <div className="onboarding-frame">
            <div className="onboarding-top"><button className="back-button" onClick={() => setOnboardingStep(3)}>← Voltar</button><span className="step-count">último detalhe</span></div>
            <section className="onboarding-card">
              <p className="eyebrow">Contas que já têm destino</p>
              <h1>Quanto vai de contas fixas por mês?</h1>
              <p className="subcopy">Aluguel, luz, internet, cartão e assinaturas. Esse valor fica protegido antes de eu sugerir o que dá para gastar.</p>
              <div className="range-options">
                {[600, 1200, 2000, 3000].map((value, index) => <button key={value} className="quick-button" onClick={() => setFixedCosts(value)}>{index === 0 ? "até R$ 800" : index === 1 ? "R$ 800 a R$ 1.500" : index === 2 ? "R$ 1.500 a R$ 2.500" : "mais de R$ 2.500"}{fixedCosts === value ? "  ✓" : ""}</button>)}
              </div>
              <div className="onboarding-continue"><button className="primary-button" onClick={finishOnboarding}>Ver meu plano →</button></div>
            </section>
          </div>
        </main>
      );
    }
    const step = onboardingSteps[onboardingStep];
    return (
      <main className="onboarding">
        <div className="onboarding-frame">
          <div className="onboarding-top"><button className="back-button" onClick={() => onboardingStep === 0 ? setScreen("dashboard") : setOnboardingStep((value) => value - 1)}>← Voltar</button><span className="step-count">{onboardingStep + 1} de 5</span></div>
          <section className="onboarding-card">
            <p className="eyebrow">{step.eyebrow}</p>
            <h1>{step.title}</h1>
            <p className="subcopy">{step.copy}</p>
            <div className="choices">
              {step.choices.map(([emoji, label]) => <button key={label} className="choice-button" onClick={nextOnboarding}><span className="choice-emoji">{emoji}</span>{label}</button>)}
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-bar">
        <button className="brand" aria-label="Navi, página inicial" onClick={() => setActiveTab("Hoje")}><span className="brand-mark">n</span>navi.</button>
        <div className="top-actions"><button className="icon-button" aria-label="Notificações">⌁</button><button className="avatar" aria-label="Seu perfil">{firstName.slice(0, 2).toUpperCase()}</button></div>
      </header>

      <div className="page">
        <section className="welcome-row">
          <div><p className="eyebrow">Bom dia, {firstName}</p><h1>Seu dinheiro está no rumo.</h1><p className="subcopy">Hoje é um bom dia para escolher com calma.</p></div>
          <button className="primary-button" onClick={() => setShowModal(true)}>＋ Registrar agora</button>
        </section>

        <section className="dashboard-grid">
          <div className="left-stack">
            <article className="panel hero-card">
              <div className="hero-content">
                <p className="hero-label">Disponível hoje</p>
                <div className="hero-amount">{money(availableToday)} <small>/dia</small></div>
                <p className="hero-copy">Você pode gastar isso hoje sem apertar as contas fixas nem abandonar a sua reserva.</p>
                <div className="hero-footer"><span className="date-pill">● até a próxima entrada em 10 dias</span><button className="secondary-button" onClick={() => setScreen("onboarding")}>Refazer plano</button></div>
              </div>
            </article>

            <article className="panel monthly-card">
              <div className="panel-title-row"><h2 className="panel-title">Este mês</h2><button className="text-button" onClick={() => setActiveTab("Gastos")}>Ver gastos →</button></div>
              <div className="month-progress-number"><strong>{usedPercent}%</strong><span>do orçamento livre usado</span></div>
              <div className="progress-track"><div className="progress-bar" style={{ width: `${usedPercent}%` }} /></div>
              <div className="month-meta"><span><strong>{money(spent)}</strong> usados</span><span>{money(Math.max(0, budget - spent))} restantes</span></div>
            </article>

            <article className="panel list-card">
              <div className="panel-title-row"><h2 className="panel-title">Movimentações recentes</h2><button className="text-button" onClick={() => setShowModal(true)}>Adicionar</button></div>
              <div className="transaction-list">
                {transactions.slice(0, 4).map((item) => <TransactionRow key={item.id} item={item} />)}
              </div>
            </article>
          </div>

          <aside className="right-stack">
            <article className="panel focus-card"><p className="eyebrow">Foco da semana</p><h2>Proteger sua reserva antes de qualquer impulso.</h2><button className="primary-button" onClick={() => showToast("Reserva protegida: você já guardou R$ 1.250 este mês.")}>Ver minha reserva</button></article>
            <article className="panel goal-card"><div className="goal-cover"><strong>Viagem de fim de ano</strong></div><div className="goal-caption"><strong>R$ 3.240 de R$ 6.000</strong><span>54%</span></div><div className="progress-track"><div className="progress-bar" style={{ width: "54%" }} /></div><div className="month-meta"><span>meta para dezembro</span><button className="text-button" onClick={() => showToast("Em breve você poderá ajustar metas por aqui.")}>Detalhes</button></div></article>
            <article className="insight-card"><span className="insight-badge">✦</span><p><strong>Um insight para você:</strong><br />transporte já passou do que você costuma gastar nesta altura do mês.</p></article>
          </aside>
        </section>

        {activeTab !== "Hoje" && <section style={{ marginTop: 28 }}><div className="section-heading"><div><p className="eyebrow">Visão geral</p><h2>{activeTab}</h2></div><button className="secondary-button" onClick={() => setShowModal(true)}>Novo lançamento</button></div><article className="panel full-transactions"><div className="transaction-list">{transactions.map((item) => <TransactionRow key={item.id} item={item} />)}</div></article></section>}
      </div>

      <nav className="bottom-nav" aria-label="Navegação principal">
        {[ ["Hoje", "◷"], ["Gastos", "▥"], ["Metas", "◎"], ["Perfil", "◌"] ].map(([label, icon]) => <button key={label} className={`nav-item ${activeTab === label ? "active" : ""}`} onClick={() => label === "Perfil" ? showToast("Seu perfil está protegido e vinculado à sua conta.") : setActiveTab(label)}><span>{icon}</span>{label}</button>)}
      </nav>

      {showModal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowModal(false); }}><form className="modal" onSubmit={submitTransaction}>
        <div className="modal-header"><div><h2>Novo lançamento</h2><p>Leva poucos segundos. A navi atualiza seu limite na hora.</p></div><button className="close-button" type="button" aria-label="Fechar" onClick={() => setShowModal(false)}>×</button></div>
        <div className="type-switch"><button type="button" className={draft.kind === "expense" ? "active" : ""} onClick={() => setDraft({ ...draft, kind: "expense" })}>Saída</button><button type="button" className={draft.kind === "income" ? "active" : ""} onClick={() => setDraft({ ...draft, kind: "income" })}>Entrada</button></div>
        <div className="form-grid"><div className="field"><label htmlFor="title">O que foi?</label><input id="title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Ex.: almoço, salário, Uber" autoFocus /></div><div className="field"><label htmlFor="amount">Valor</label><input id="amount" value={draft.amount} inputMode="decimal" onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="0,00" /></div>{draft.kind === "expense" && <div className="field"><label htmlFor="category">Categoria</label><select id="category" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{Object.keys(categoryIcons).filter((item) => !["Renda", "Outros"].includes(item)).map((item) => <option key={item}>{item}</option>)}</select></div>}</div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setShowModal(false)}>Cancelar</button><button className="primary-button" type="submit">Salvar lançamento</button></div>
      </form></div>}

      {toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>}
    </main>
  );
}

function TransactionRow({ item }: { item: Transaction }) {
  return <div className="transaction"><span className="transaction-icon" style={{ background: item.tone }}>{item.icon}</span><div className="transaction-info"><strong>{item.title}</strong><span>{item.day} · {item.category}</span></div><span className={`transaction-value ${item.kind}`}>{item.kind === "income" ? "+" : "−"} {money(item.amount)}</span></div>;
}
