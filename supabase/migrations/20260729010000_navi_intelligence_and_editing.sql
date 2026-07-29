-- Navi: inteligência do ciclo financeiro e edição explícita de parcelamentos.
alter table public.installment_plans
  add column if not exists current_installment smallint not null default 1,
  add column if not exists due_day smallint,
  add column if not exists notes text;

alter table public.installment_plans drop constraint if exists installment_plans_current_installment_check;
alter table public.installment_plans add constraint installment_plans_current_installment_check
  check (current_installment between 1 and installment_count);

alter table public.installment_plans drop constraint if exists installment_plans_due_day_check;
alter table public.installment_plans add constraint installment_plans_due_day_check
  check (due_day is null or due_day between 1 and 31);

alter table public.budgets
  add column if not exists allocation_percent numeric(6,3);

alter table public.recurring_templates
  add column if not exists is_fixed boolean not null default true,
  add column if not exists notes text;

-- Sincroniza a parcela atual com o maior número já importado para cada plano.
update public.installment_plans plan
set current_installment = greatest(
  1,
  least(
    plan.installment_count,
    coalesce((
      select max(transaction.installment_number)
      from public.transactions transaction
      where transaction.installment_plan_id = plan.id
        and transaction.status <> 'cancelled'
    ), 1)
  )
);

create index if not exists recurring_templates_user_next_due_idx
  on public.recurring_templates(user_id, next_due_on)
  where is_active = true;

create index if not exists installment_plans_user_status_idx
  on public.installment_plans(user_id, status);
