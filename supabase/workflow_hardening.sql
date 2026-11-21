create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from private.platform_admins where user_id=auth.uid());
$$;
create or replace function private.can_work(p_clinic uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.clinic_members m join public.clinics c on c.id=m.clinic_id
    where m.user_id=auth.uid() and m.clinic_id=p_clinic and c.active);
$$;
create or replace function private.can_manage(p_clinic uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (private.is_platform_admin() or exists(
    select 1 from public.clinic_members where clinic_id=p_clinic and user_id=auth.uid() and role='owner'));
$$;
create or replace function private.appointment_lifecycle() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' then
    new.created_at=clock_timestamp(); new.updated_at=new.created_at;
    new.started_at=null; new.completed_at=null;
  else
    if new.clinic_id<>old.clinic_id or new.created_by<>old.created_by or new.created_at<>old.created_at then
      raise exception 'A clínica e o autor do registro não podem ser alterados.';
    end if;
    if new.report<>old.report or new.patient_label<>old.patient_label or new.age is distinct from old.age or new.report_source<>old.report_source then
      raise exception 'O relato original é preservado. Registre os complementos nas respostas.';
    end if;
    new.started_at=old.started_at; new.completed_at=old.completed_at;
    if new.status<>old.status then
      if old.status='Aguardando' and new.status<>'Em atendimento' then
        raise exception 'Inicie o atendimento antes de finalizar.';
      end if;
      if old.status='Em atendimento' and new.status<>'Finalizado' then
        raise exception 'Um atendimento iniciado só pode ser finalizado.';
      end if;
      if old.status='Finalizado' then raise exception 'Este atendimento já foi finalizado.'; end if;
      if new.status='Em atendimento' then new.started_at=clock_timestamp(); end if;
      if new.status='Finalizado' then new.completed_at=clock_timestamp(); end if;
    end if;
    if old.status='Finalizado' and (new.ai_summary is distinct from old.ai_summary or new.analysis_stale<>old.analysis_stale) then
      raise exception 'Um atendimento finalizado não pode ser modificado.';
    end if;
    new.updated_at=clock_timestamp();
  end if;
  return new;
end;
$$;
create or replace function private.save_answers(p_id uuid,p_answers jsonb,p_summary text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; entry jsonb; current_questions jsonb;
begin
  select * into a from public.appointments where id=p_id for update;
  if not found or not private.can_work(a.clinic_id) then raise exception 'Atendimento não encontrado ou sem acesso.'; end if;
  if a.status='Finalizado' then raise exception 'Atendimento finalizado. As respostas não podem ser alteradas.'; end if;
  if a.ai_summary is distinct from p_summary then raise exception 'A ficha mudou. Atualize a lista antes de responder.'; end if;
  if jsonb_typeof(p_answers) is distinct from 'array' then raise exception 'Informe uma lista de respostas.'; end if;
  if jsonb_array_length(p_answers) not between 1 and 4 then raise exception 'Informe de uma a quatro respostas.'; end if;
  begin current_questions=(a.ai_summary::jsonb)->'questions'; exception when others then raise exception 'Gere a ficha antes de responder.'; end;
  if current_questions is null or jsonb_typeof(current_questions)<>'array' then raise exception 'Gere a ficha antes de responder.'; end if;
  if (select count(*) from public.appointment_answers where appointment_id=p_id)+jsonb_array_length(p_answers)>40 then raise exception 'Limite de 40 respostas por atendimento atingido.'; end if;
  for entry in select value from jsonb_array_elements(p_answers) loop
    if jsonb_typeof(entry->'question') is distinct from 'string' or jsonb_typeof(entry->'answer') is distinct from 'string'
      or not (current_questions ? (entry->>'question')) or length(trim(entry->>'answer')) not between 1 and 500 then
      raise exception 'Pergunta ou resposta inválida.';
    end if;
    if exists(select 1 from public.appointment_answers where appointment_id=p_id and question=entry->>'question') then
      raise exception 'Esta pergunta já foi respondida. Atualize a ficha para continuar.';
    end if;
    insert into public.appointment_answers(appointment_id,question,answer,recorded_by)
    values(p_id,entry->>'question',trim(entry->>'answer'),auth.uid());
  end loop;
  update public.appointments set analysis_stale=true where id=p_id;
end;
$$;
create or replace function private.create_clinic(p_name text,p_owner_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid; owner_id uuid;
begin
  if not private.is_platform_admin() then raise exception 'Somente o superadministrador pode cadastrar clínicas.'; end if;
  if length(trim(p_name)) not between 2 and 100 then raise exception 'Informe um nome entre 2 e 100 caracteres.'; end if;
  select id into owner_id from auth.users where lower(email)=lower(trim(p_owner_email)) and email_confirmed_at is not null;
  if owner_id is null then raise exception 'O administrador precisa criar e confirmar sua conta antes do vínculo.'; end if;
  insert into public.clinics(name) values(trim(p_name)) returning id into new_id;
  insert into public.clinic_members(clinic_id,user_id,role) values(new_id,owner_id,'owner');
  return new_id;
end;
$$;
create or replace function private.set_clinic_active(p_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then raise exception 'Acesso restrito ao superadministrador.'; end if;
  if p_active is null then raise exception 'Situação inválida.'; end if;
  update public.clinics set active=p_active where id=p_id;
  if not found then raise exception 'Clínica não encontrada.'; end if;
end;
$$;
create or replace function private.list_team(p_clinic uuid)
returns table(user_id uuid,email text,role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_manage(p_clinic) then raise exception 'Sem permissão para gerenciar esta equipe.'; end if;
  return query select m.user_id,u.email::text,m.role from public.clinic_members m join auth.users u on u.id=m.user_id where m.clinic_id=p_clinic order by m.role,u.email;
end;
$$;
create or replace function private.add_member(p_clinic uuid,p_email text,p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  if not private.can_manage(p_clinic) then raise exception 'Sem permissão para gerenciar esta equipe.'; end if;
  if p_role not in ('owner','staff') or (p_role='owner' and not private.is_platform_admin()) then raise exception 'Somente o superadministrador define administradores.'; end if;
  if not exists(select 1 from public.clinics where id=p_clinic and active) then raise exception 'Clínica inativa ou inexistente.'; end if;
  select id into target_id from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
  if target_id is null then raise exception 'A pessoa precisa criar e confirmar sua conta antes do vínculo.'; end if;
  insert into public.clinic_members(clinic_id,user_id,role) values(p_clinic,target_id,p_role)
  on conflict(clinic_id,user_id) do nothing;
  if not found then raise exception 'Esta conta já integra a clínica.'; end if;
end;
$$;
create or replace function private.remove_member(p_clinic uuid,p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target_role text;
begin
  if not private.can_manage(p_clinic) then raise exception 'Sem permissão para gerenciar esta equipe.'; end if;
  perform 1 from public.clinics where id=p_clinic for update;
  select role into target_role from public.clinic_members where clinic_id=p_clinic and user_id=p_user;
  if target_role is null then raise exception 'Vínculo não encontrado.'; end if;
  if target_role='owner' then
    if not private.is_platform_admin() then raise exception 'Somente o superadministrador remove administradores.'; end if;
    if (select count(*) from public.clinic_members where clinic_id=p_clinic and role='owner')<=1 then raise exception 'Mantenha ao menos um administrador na clínica.'; end if;
  end if;
  delete from public.clinic_members where clinic_id=p_clinic and user_id=p_user;
end;
$$;
create or replace function public.is_platform_admin() returns boolean language sql stable security invoker set search_path='' as $$select private.is_platform_admin()$$;
create or replace function public.save_appointment_answers(p_id uuid,p_answers jsonb,p_summary text) returns void language sql security invoker set search_path='' as $$select private.save_answers(p_id,p_answers,p_summary)$$;
create or replace function public.create_clinic(p_name text,p_owner_email text) returns uuid language sql security invoker set search_path='' as $$select private.create_clinic(p_name,p_owner_email)$$;
create or replace function public.set_clinic_active(p_id uuid,p_active boolean) returns void language sql security invoker set search_path='' as $$select private.set_clinic_active(p_id,p_active)$$;
create or replace function public.list_clinic_team(p_clinic uuid) returns table(user_id uuid,email text,role text) language sql stable security invoker set search_path='' as $$select * from private.list_team(p_clinic)$$;
create or replace function public.add_clinic_member(p_clinic uuid,p_email text,p_role text) returns void language sql security invoker set search_path='' as $$select private.add_member(p_clinic,p_email,p_role)$$;
create or replace function public.remove_clinic_member(p_clinic uuid,p_user uuid) returns void language sql security invoker set search_path='' as $$select private.remove_member(p_clinic,p_user)$$;
create index if not exists clinic_members_user_idx on public.clinic_members(user_id);
create index if not exists appointments_author_idx on public.appointments(created_by);
create index if not exists answers_recorder_idx on public.appointment_answers(recorded_by);
alter policy member_self on public.clinic_members using(user_id=(select auth.uid()));
alter policy clinic_read on public.clinics using((select private.is_platform_admin()) or exists(select 1 from public.clinic_members m where m.clinic_id=clinics.id and m.user_id=(select auth.uid())));
alter policy appointment_insert on public.appointments with check(private.can_work(clinic_id) and created_by=(select auth.uid()) and status='Aguardando' and ai_summary is null);
