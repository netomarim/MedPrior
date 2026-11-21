-- Teste de integração no Supabase. Todos os usuários e registros de teste são revertidos.
begin;
select set_config('medprior.test_admin',(select user_id::text from private.platform_admins limit 1),true);
select set_config('medprior.test_owner',gen_random_uuid()::text,true);
select set_config('medprior.test_staff',gen_random_uuid()::text,true);
select set_config('medprior.test_other',gen_random_uuid()::text,true);
select set_config('medprior.test_c1',gen_random_uuid()::text,true);
select set_config('medprior.test_c2',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at,aud,role)
select current_setting('medprior.test_owner')::uuid,'workflow-owner-'||gen_random_uuid()||'@example.test',now(),'authenticated','authenticated'
union all select current_setting('medprior.test_staff')::uuid,'workflow-staff-'||gen_random_uuid()||'@example.test',now(),'authenticated','authenticated'
union all select current_setting('medprior.test_other')::uuid,'workflow-other-'||gen_random_uuid()||'@example.test',now(),'authenticated','authenticated';
select set_config('medprior.test_owner_email',(select email from auth.users where id=current_setting('medprior.test_owner')::uuid),true);
insert into public.clinics(id,name) values(current_setting('medprior.test_c1')::uuid,'Workflow clinic one'),(current_setting('medprior.test_c2')::uuid,'Workflow clinic two');
insert into public.clinic_members(clinic_id,user_id,role) values
(current_setting('medprior.test_c1')::uuid,current_setting('medprior.test_owner')::uuid,'owner'),
(current_setting('medprior.test_c1')::uuid,current_setting('medprior.test_staff')::uuid,'staff'),
(current_setting('medprior.test_c2')::uuid,current_setting('medprior.test_other')::uuid,'owner');
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('medprior.test_staff'),'role','authenticated')::text,true);
do $$
declare denied boolean; a_id uuid; answers_count int;
begin
 if public.is_platform_admin() then raise exception 'FAIL staff escalated'; end if;
 denied=false; begin perform public.create_clinic('Forbidden',current_setting('medprior.test_owner_email')); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL staff created clinic'; end if;
 denied=false; begin perform public.list_clinic_team(current_setting('medprior.test_c2')::uuid); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL cross-clinic team exposed'; end if;
 denied=false; begin insert into private.platform_admins(user_id) values(auth.uid()); exception when insufficient_privilege then denied=true; end;
 if not denied then raise exception 'FAIL staff elevated itself'; end if;
 insert into public.appointments(clinic_id,created_by,patient_label,report,ai_summary)
 values(current_setting('medprior.test_c1')::uuid,auth.uid(),'Fictitious patient','Dry cough for two days',null) returning id into a_id;
 perform set_config('medprior.test_appointment',a_id::text,true);
 update public.appointments set ai_summary='{"version":2,"facts":["Cough"],"gaps":["Evolution"],"questions":["Has it improved?"],"note":"Confirm evolution."}' where id=a_id;
 perform public.save_appointment_answers(a_id,'[{"question":"Has it improved?","answer":"Improved since yesterday."}]',
  (select ai_summary from public.appointments where id=a_id));
 select count(*) into answers_count from public.appointment_answers where appointment_id=a_id;
 if answers_count<>1 or (select analysis_stale from public.appointments where id=a_id) or (select ai_summary::jsonb->>'phase' from public.appointments where id=a_id)<>'complete' then raise exception 'FAIL final consolidation not saved atomically'; end if;
 denied=false; begin perform public.save_appointment_answers(a_id,'[{"question":"Not a generated question","answer":"Something"}]',
  (select ai_summary from public.appointments where id=a_id)); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL accepted fabricated question'; end if;
 denied=false; begin insert into public.appointment_answers(appointment_id,question,answer,recorded_by) values(a_id,'Tamper','Answer',auth.uid()); exception when insufficient_privilege then denied=true; end;
 if not denied then raise exception 'FAIL direct answer insert allowed'; end if;
 denied=false; begin update public.appointments set clinic_id=current_setting('medprior.test_c2')::uuid where id=a_id; exception when others then denied=true; end;
 if not denied then raise exception 'FAIL moved appointment between clinics'; end if;
 denied=false; begin update public.appointments set status='Finalizado' where id=a_id; exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL skipped attendance lifecycle'; end if;
 denied=false; begin update public.appointments set priority='urgent' where id=a_id; exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL priority accepted without professional attribution'; end if;
 update public.appointments set priority='urgent',priority_assessor='Profissional ficticio - registro demonstrativo',priority_reason='Classificacao ficticia informada pela equipe de saude' where id=a_id;
 if (select priority_recorded_by is distinct from auth.uid() or priority_recorded_at is null from public.appointments where id=a_id) then raise exception 'FAIL priority author or timestamp missing'; end if;
 update public.appointments set priority_recorded_by=current_setting('medprior.test_other')::uuid where id=a_id;
 if (select priority_recorded_by is distinct from auth.uid() from public.appointments where id=a_id) then raise exception 'FAIL priority author could be forged'; end if;
 update public.appointments set status='Em atendimento' where id=a_id;
 update public.appointments set status='Finalizado' where id=a_id;
 if (public.clinic_statistics(current_setting('medprior.test_c1')::uuid)->>'done_today')::int<>1 then raise exception 'FAIL completed date counter'; end if;
 if (select started_at is null or completed_at is null from public.appointments where id=a_id) then raise exception 'FAIL lifecycle timestamps'; end if;
 denied=false; begin update public.appointments set status='Em atendimento' where id=a_id; exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL reopened finalized appointment'; end if;
 denied=false; begin perform public.save_appointment_answers(a_id,'[{"question":"Has it improved?","answer":"New"}]',
  (select ai_summary from public.appointments where id=a_id)); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL edited finalized interview'; end if;
 delete from public.appointments where id=a_id;
 if not exists(select 1 from public.appointments where id=a_id) then raise exception 'FAIL staff deleted record'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('medprior.test_other'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.appointments where id=current_setting('medprior.test_appointment')::uuid) then raise exception 'FAIL cross-clinic appointment leak'; end if;
 if exists(select 1 from public.appointment_answers where appointment_id=current_setting('medprior.test_appointment')::uuid) then raise exception 'FAIL cross-clinic answers leak'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('medprior.test_owner'),'role','authenticated')::text,true);
do $$ declare denied boolean=false; begin
 if (select count(*) from public.list_clinic_team(current_setting('medprior.test_c1')::uuid))<>2 then raise exception 'FAIL owner cannot list team'; end if;
 begin perform public.add_clinic_member(current_setting('medprior.test_c1')::uuid,current_setting('medprior.test_owner_email'),'owner'); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL owner created owner'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('medprior.test_admin'),'role','authenticated')::text,true);
do $$ declare new_clinic uuid; denied boolean=false; begin
 if not public.is_platform_admin() then raise exception 'FAIL platform admin denied'; end if;
 new_clinic=public.create_clinic('Workflow newly created clinic',current_setting('medprior.test_owner_email'));
 if not exists(select 1 from public.clinics where id=new_clinic) then raise exception 'FAIL admin cannot create clinic'; end if;
 if (select count(*) from public.list_clinic_team(new_clinic))<>1 then raise exception 'FAIL initial owner not assigned'; end if;
 if exists(select 1 from public.appointments where id=current_setting('medprior.test_appointment')::uuid) then raise exception 'FAIL platform admin gained clinical access without membership'; end if;
 begin perform public.remove_clinic_member(new_clinic,current_setting('medprior.test_owner')::uuid); exception when raise_exception then denied=true; end;
 if not denied then raise exception 'FAIL removed last owner'; end if;
 perform public.set_clinic_active(current_setting('medprior.test_c1')::uuid,false);
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('medprior.test_staff'),'role','authenticated')::text,true);
do $$ begin
 if exists(select 1 from public.appointments where clinic_id=current_setting('medprior.test_c1')::uuid) then raise exception 'FAIL inactive clinic still accessible'; end if;
end $$;
set local role anon;
do $$ declare denied boolean=false; begin
 begin perform public.is_platform_admin(); exception when insufficient_privilege then denied=true; end;
 if not denied then raise exception 'FAIL anonymous RPC access'; end if;
end $$;
rollback;
select 'PASS: role escalation, tenant isolation, clinic creation, owner protection, answers, lifecycle and deactivation; all fixtures rolled back' as result;
