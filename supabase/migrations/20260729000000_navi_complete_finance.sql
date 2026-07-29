-- Navi: modelo financeiro completo, compatível com a primeira versão.
create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.profiles
  add column if not exists currency text not null default 'BRL',
  add column if not exists locale text not null default 'pt-BR',
  add column if not exists daily_limit_mode text not null default 'conservative',
  add column if not exists reserve_percent numeric(5,2) not null default 10,
  add column if not exists seed_version integer not null default 0;

alter table public.profiles drop constraint if exists profiles_daily_limit_mode_check;
alter table public.profiles add constraint profiles_daily_limit_mode_check
  check (daily_limit_mode in ('conservative', 'cashflow'));

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  institution text,
  type text not null default 'checking' check (type in ('checking', 'savings', 'cash', 'investment', 'other')),
  initial_balance_cents bigint not null default 0,
  balance_as_of date not null default current_date,
  color text not null default '#0b6cf0',
  icon text not null default 'wallet',
  is_active boolean not null default true,
  source_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source_fingerprint)
);
create index if not exists accounts_user_idx on public.accounts(user_id, is_active);

create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  institution text,
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  limit_cents bigint not null default 0 check (limit_cents >= 0),
  closing_day smallint check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  color text not null default '#111827',
  is_active boolean not null default true,
  source_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source_fingerprint)
);
create index if not exists credit_cards_user_idx on public.credit_cards(user_id, is_active);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null default 'expense' check (kind in ('expense', 'income', 'both')),
  parent_id uuid references public.categories(id) on delete cascade,
  icon text not null default 'tag',
  color text not null default '#64748b',
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, name, parent_id)
);
create index if not exists categories_user_idx on public.categories(user_id, is_active);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  credit_card_id uuid not null references public.credit_cards(id) on delete cascade,
  reference_month date not null,
  closing_date date,
  due_date date not null,
  total_cents bigint not null default 0,
  status text not null default 'open' check (status in ('open', 'closed', 'paid', 'overdue')),
  paid_at timestamptz,
  payment_account_id uuid references public.accounts(id) on delete set null,
  source_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, credit_card_id, reference_month),
  unique(user_id, source_fingerprint)
);
create index if not exists invoices_user_due_idx on public.invoices(user_id, due_date);

create table if not exists public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  credit_card_id uuid references public.credit_cards(id) on delete set null,
  description text not null,
  category_id uuid references public.categories(id) on delete set null,
  total_cents bigint not null check (total_cents > 0),
  installment_cents bigint not null check (installment_cents > 0),
  installment_count smallint not null check (installment_count > 1),
  first_installment_on date not null,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  source_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source_fingerprint)
);

alter table public.transactions
  add column if not exists account_id uuid references public.accounts(id) on delete set null,
  add column if not exists destination_account_id uuid references public.accounts(id) on delete set null,
  add column if not exists credit_card_id uuid references public.credit_cards(id) on delete set null,
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null,
  add column if not exists category_id uuid references public.categories(id) on delete set null,
  add column if not exists installment_plan_id uuid references public.installment_plans(id) on delete set null,
  add column if not exists installment_number smallint,
  add column if not exists installment_count smallint,
  add column if not exists status text not null default 'paid',
  add column if not exists notes text,
  add column if not exists source text not null default 'manual',
  add column if not exists source_fingerprint text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('expense', 'income', 'transfer', 'card_purchase', 'card_payment', 'refund', 'goal_contribution', 'adjustment'));
alter table public.transactions drop constraint if exists transactions_status_check;
alter table public.transactions add constraint transactions_status_check
  check (status in ('planned', 'pending', 'paid', 'cancelled'));
alter table public.transactions drop constraint if exists transactions_installment_check;
alter table public.transactions add constraint transactions_installment_check check (
  (installment_number is null and installment_count is null)
  or (installment_number between 1 and installment_count and installment_count > 0)
);
create unique index if not exists transactions_source_fingerprint_idx
  on public.transactions(user_id, source_fingerprint) where source_fingerprint is not null;
create index if not exists transactions_invoice_idx on public.transactions(invoice_id);
create index if not exists transactions_account_idx on public.transactions(account_id, occurred_on);

create table if not exists public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  category_id uuid references public.categories(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  destination_account_id uuid references public.accounts(id) on delete set null,
  frequency text not null default 'monthly' check (frequency in ('weekly', 'monthly', 'yearly')),
  day_of_month smallint check (day_of_month between 1 and 31),
  starts_on date not null default current_date,
  ends_on date,
  next_due_on date not null default current_date,
  is_active boolean not null default true,
  source_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source_fingerprint)
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  reference_month date not null,
  limit_cents bigint not null check (limit_cents >= 0),
  rollover boolean not null default false,
  source_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, category_id, reference_month),
  unique(user_id, source_fingerprint)
);

alter table public.goals
  add column if not exists account_id uuid references public.accounts(id) on delete set null,
  add column if not exists monthly_contribution_cents bigint not null default 0,
  add column if not exists status text not null default 'active',
  add column if not exists protected boolean not null default true,
  add column if not exists color text not null default '#0b6cf0',
  add column if not exists notes text,
  add column if not exists source_fingerprint text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.goals drop constraint if exists goals_status_check;
alter table public.goals add constraint goals_status_check check (status in ('active', 'completed', 'paused', 'cancelled'));
create unique index if not exists goals_source_fingerprint_idx
  on public.goals(user_id, source_fingerprint) where source_fingerprint is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_user_source_unique') then
    alter table public.transactions add constraint transactions_user_source_unique unique(user_id, source_fingerprint);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'goals_user_source_unique') then
    alter table public.goals add constraint goals_user_source_unique unique(user_id, source_fingerprint);
  end if;
end $$;

create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  amount_cents bigint not null check (amount_cents > 0),
  occurred_on date not null default current_date,
  notes text,
  source_fingerprint text,
  created_at timestamptz not null default now(),
  unique(user_id, source_fingerprint)
);

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text,
  starts_on date not null default current_date,
  months smallint not null default 12 check (months between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scenario_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scenario_id uuid not null references public.scenarios(id) on delete cascade,
  month_offset smallint not null check (month_offset between 0 and 59),
  kind text not null check (kind in ('income', 'expense', 'goal')),
  description text not null,
  amount_cents bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  match_text text not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  priority smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_id, match_text)
);

create table if not exists public.app_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  seed_version integer not null default 0,
  daily_limit_mode text not null default 'conservative' check (daily_limit_mode in ('conservative', 'cashflow')),
  reserve_percent numeric(5,2) not null default 10,
  onboarding_data jsonb not null default '{}'::jsonb,
  last_backup_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'accounts','credit_cards','categories','invoices','installment_plans',
    'recurring_templates','budgets','goal_contributions','scenarios',
    'scenario_items','categorization_rules','app_settings'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || ' own rows', table_name);
    if table_name = 'app_settings' then
      execute format(
        'create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
        table_name || ' own rows', table_name
      );
    else
      execute format(
        'create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
        table_name || ' own rows', table_name
      );
    end if;
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','accounts','credit_cards','invoices','installment_plans',
    'transactions','recurring_templates','budgets','goals','scenarios','app_settings'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'touch_' || table_name || '_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      'touch_' || table_name || '_updated_at', table_name
    );
  end loop;
end $$;

create or replace function public.recalculate_invoice_total(target_invoice_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.invoices i
  set total_cents = coalesce((
    select sum(case when t.kind = 'refund' then -t.amount_cents else t.amount_cents end)
    from public.transactions t
    where t.invoice_id = target_invoice_id
      and t.kind in ('card_purchase', 'refund')
      and t.status <> 'cancelled'
  ), 0)
  where i.id = target_invoice_id and i.user_id = auth.uid();
$$;
