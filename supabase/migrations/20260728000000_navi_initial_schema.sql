create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  monthly_income_cents integer not null default 0 check (monthly_income_cents >= 0),
  fixed_costs_cents integer not null default 0 check (fixed_costs_cents >= 0),
  income_day smallint not null default 5 check (income_day between 1 and 31),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  amount_cents integer not null check (amount_cents > 0),
  description text not null check (char_length(description) between 1 and 120),
  category text not null check (char_length(category) between 1 and 60),
  occurred_on date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, occurred_on desc);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  target_cents integer not null check (target_cents > 0),
  saved_cents integer not null default 0 check (saved_cents >= 0),
  target_date date,
  created_at timestamptz not null default now()
);

create index if not exists goals_user_created_idx on public.goals (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.goals enable row level security;

create policy "profiles own rows" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "transactions own rows" on public.transactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "goals own rows" on public.goals for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
