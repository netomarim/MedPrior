create function public.clinic_statistics(p_clinic uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
   'total',count(*),
   'waiting',count(*) filter(where status='Aguardando'),
   'progress',count(*) filter(where status='Em atendimento'),
   'done_today',count(*) filter(where status='Finalizado' and (completed_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date),
   'average_minutes',round(avg(extract(epoch from (completed_at-started_at))/60) filter(where status='Finalizado' and started_at is not null and completed_at is not null),1)
 ) from public.appointments where clinic_id=p_clinic;
$$;
revoke all on function public.clinic_statistics(uuid) from public,anon;
grant execute on function public.clinic_statistics(uuid) to authenticated;
