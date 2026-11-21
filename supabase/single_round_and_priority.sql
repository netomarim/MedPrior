alter table public.appointments drop constraint appointments_ai_summary_check;
alter table public.appointments add constraint appointments_ai_summary_check check(char_length(ai_summary)<=35000);
alter table public.appointments
  add column priority text not null default 'not_assessed' check(priority in ('not_assessed','non_urgent','low_urgency','urgent','very_urgent','emergency')),
  add column priority_assessor text check(length(priority_assessor)<=120),
  add column priority_reason text check(length(priority_reason)<=500),
  add column priority_recorded_by uuid references auth.users(id),
  add column priority_recorded_at timestamptz;
create index appointments_priority_author_idx on public.appointments(priority_recorded_by);

create function private.record_priority() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
   if new.priority<>'not_assessed' then raise exception 'Registre a avaliação profissional depois de cadastrar o atendimento.'; end if;
   new.priority_assessor=null;new.priority_reason=null;new.priority_recorded_by=null;new.priority_recorded_at=null;
 else
   if new.priority is distinct from old.priority or new.priority_assessor is distinct from old.priority_assessor or new.priority_reason is distinct from old.priority_reason then
     if old.status='Finalizado' then raise exception 'Atendimento finalizado: prioridade disponível somente para consulta.'; end if;
     if new.priority<>'not_assessed' and (new.priority_assessor is null or length(trim(new.priority_assessor))<3) then
       raise exception 'Informe o nome e registro do profissional responsável pela classificação.';
     end if;
     new.priority_recorded_by=auth.uid();new.priority_recorded_at=clock_timestamp();
   else
     new.priority_recorded_by=old.priority_recorded_by;new.priority_recorded_at=old.priority_recorded_at;
   end if;
 end if;
 return new;
end $$;
create trigger appointment_priority before insert or update on public.appointments for each row execute function private.record_priority();

create function private.consolidate_appointment(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare a public.appointments; responses jsonb; summary text;
begin
 select * into a from public.appointments where id=p_id for update;
 if not found or not private.can_work(a.clinic_id) then raise exception 'Atendimento não encontrado ou sem acesso.'; end if;
 if a.status='Finalizado' then raise exception 'Este atendimento já foi finalizado.'; end if;
 select jsonb_agg(jsonb_build_object('question',question,'answer',answer) order by recorded_at,id) into responses from public.appointment_answers where appointment_id=p_id;
 if responses is null then raise exception 'Registre as respostas antes de consolidar a ficha.'; end if;
 summary=jsonb_build_object('version',3,'phase','complete','facts',jsonb_build_array(a.report),
   'gaps','[]'::jsonb,'questions','[]'::jsonb,'recordedAnswers',responses,
   'note','Rodada de perguntas encerrada. Relato e respostas transcritos conforme registrados, sem nova avaliação ou interpretação por IA.')::text;
 update public.appointments set ai_summary=summary,analysis_stale=false where id=p_id;
 return summary;
end $$;
create function public.consolidate_appointment(p_id uuid) returns text language sql security invoker set search_path='' as $$select private.consolidate_appointment(p_id)$$;
revoke all on function private.consolidate_appointment(uuid),private.record_priority(),public.consolidate_appointment(uuid) from public,anon;
grant execute on function private.consolidate_appointment(uuid),public.consolidate_appointment(uuid) to authenticated;

create or replace function private.save_answers(p_id uuid,p_answers jsonb,p_summary text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; entry jsonb; current_questions jsonb;
begin
  select * into a from public.appointments where id=p_id for update;
  if not found or not private.can_work(a.clinic_id) then raise exception 'Atendimento não encontrado ou sem acesso.'; end if;
  if exists(select 1 from public.appointment_answers where appointment_id=p_id) then raise exception 'A rodada de perguntas já foi encerrada. Atualize a ficha para consultar as respostas.'; end if;
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
  perform private.consolidate_appointment(p_id);
end;
$$;
