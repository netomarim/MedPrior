-- MedPrior MVP: estrutura inicial para Supabase (PostgreSQL).
-- Execute no projeto Supabase somente depois de revisar os nomes e criar a clínica.

create extension if not exists pgcrypto;

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_label text not null check (char_length(patient_label) <= 80),
  age smallint check (age between 0 and 120),
  report text not null check (char_length(report) <= 1200),
  ai_summary text check (char_length(ai_summary) <= 2000),
  status text not null default 'Aguardando'
    check (status in ('Aguardando', 'Em atendimento', 'Finalizado')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointments_clinic_created_idx
  on public.appointments (clinic_id, created_at desc);

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.appointments enable row level security;

create policy "members can view their clinics"
  on public.clinics for select to authenticated
  using (exists (
    select 1 from public.clinic_members m
    where m.clinic_id = clinics.id and m.user_id = auth.uid()
  ));

create policy "members can view clinic membership"
  on public.clinic_members for select to authenticated
  using (user_id = auth.uid());

create policy "members can view appointments in their clinic"
  on public.appointments for select to authenticated
  using (exists (
    select 1 from public.clinic_members m
    where m.clinic_id = appointments.clinic_id and m.user_id = auth.uid()
  ));

create policy "members can add appointments to their clinic"
  on public.appointments for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.clinic_members m
      where m.clinic_id = appointments.clinic_id and m.user_id = auth.uid()
    )
  );

create policy "members can update appointments in their clinic"
  on public.appointments for update to authenticated
  using (exists (
    select 1 from public.clinic_members m
    where m.clinic_id = appointments.clinic_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.clinic_members m
    where m.clinic_id = appointments.clinic_id and m.user_id = auth.uid()
  ));

create policy "members can delete appointments in their clinic"
  on public.appointments for delete to authenticated
  using (exists (
    select 1 from public.clinic_members m
    where m.clinic_id = appointments.clinic_id and m.user_id = auth.uid()
  ));
