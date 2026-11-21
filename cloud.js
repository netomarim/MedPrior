// Login pelo Supabase; autorização sempre aplicada no banco.
window.MedPriorCloud = (() => {
  const config = window.MEDPRIOR_CONFIG;
  let client = null;
  let connectionError = 'Não foi possível carregar a conexão. Confira sua internet e recarregue a página.';
  if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
    connectionError = 'Configure a URL e a chave pública do Supabase no .env e reinicie o servidor Python.';
  } else if (window.supabase?.createClient) {
    try { client = window.supabase.createClient(config.supabaseUrl,config.supabasePublishableKey); }
    catch { connectionError = 'A configuração do Supabase é inválida. Confira o .env e reinicie o servidor Python.'; }
  }
  let accessRevision = 0;
  let clinicId = null;
  let userId = null;
  let access = { isAdmin: false, clinics: [], memberships: [] };
  function requireClient() { if (!client) throw new Error(connectionError); return client; }
  function requireClinic() { requireClient(); if (!clinicId || !userId) throw new Error('Selecione uma clínica ativa.'); }
  async function rpc(name, args) { const { data, error } = await requireClient().rpc(name, args); if (error) throw error; return data; }
  function map(row) {
    return { id: row.id, patient: row.patient_label, age: row.age ?? '', report: row.report,
      createdAt: row.created_at, updatedAt: row.updated_at, startedAt: row.started_at, completedAt: row.completed_at,
      status: row.status, aiSummary: row.ai_summary ?? '', analysisStale: row.analysis_stale,
      reportSource: row.report_source, createdBy: row.created_by, priority:row.priority || 'not_assessed', priorityAssessor:row.priority_assessor || '', priorityReason:row.priority_reason || '', priorityRecordedAt:row.priority_recorded_at };
  }
  async function bind(user) {
    const revision = ++accessRevision;
    clinicId = null; userId = null;
    const isAdmin = await rpc('is_platform_admin');
    const [{ data: clinics, error: clinicError }, { data: memberships, error: memberError }] = await Promise.all([
      client.from('clinics').select('*').order('name'),
      client.from('clinic_members').select('clinic_id, role').eq('user_id', user.id),
    ]);
    if (revision !== accessRevision) throw new Error('O acesso mudou durante o carregamento. Entre novamente.');
    if (clinicError) throw clinicError; if (memberError) throw memberError;
    userId = user.id;
    access = { isAdmin, clinics, memberships };
    return access;
  }
  return {
    client, bind, map,
    get access() { return access; },
    get userId() { return userId; },
    get clinicId() { return clinicId; },
    get canManage() { return access.isAdmin || access.memberships.some(m => m.clinic_id === clinicId && m.role === 'owner'); },
    get canDelete() { return this.canManage && Boolean(clinicId); },
    selectClinic(id) {
      if (!access.clinics.some(c => c.id === id && c.active) || !access.memberships.some(m => m.clinic_id === id)) throw new Error('Sem vínculo com esta clínica ativa.');
      clinicId = id;
    },
    async session() { const {data,error} = await requireClient().auth.getSession(); if(error) throw error; return data.session; },
    async login(email,password) { const {data,error} = await requireClient().auth.signInWithPassword({email,password}); if(error) throw error; return data.session; },
    async signup(email,password) { const {data,error} = await requireClient().auth.signUp({email,password}); if(error) throw error; return data; },
    async logout() { const {error} = await requireClient().auth.signOut({scope:'local'}); if(error) throw error; this.clear(); },
    clear() { accessRevision++; clinicId=null; userId=null; access={isAdmin:false,clinics:[],memberships:[]}; },
    async list(offset = 0) {
      requireClinic(); const {data,error} = await client.from('appointments').select('*').eq('clinic_id',clinicId).order('created_at',{ascending:false}).order('id').range(offset,offset+499);
      if(error) throw error; return data.map(map);
    },
    async queue() {
      requireClinic();
      const {data,error}=await client.from('appointments').select('*').eq('clinic_id',clinicId).neq('status','Finalizado').order('created_at',{ascending:true}).order('id').limit(5);
      if(error) throw error; return data.map(map);
    },
    async stats() { requireClinic(); return rpc('clinic_statistics',{p_clinic:clinicId}); },
    async get(id) {
      requireClinic(); const {data,error} = await client.from('appointments').select('*').eq('clinic_id',clinicId).eq('id',id).single();
      if(error) throw error; return map(data);
    },
    async detail(id) {
      requireClinic();
      const {data,error}=await client.from('appointments').select('*, appointment_answers(id,question,answer,recorded_at,recorded_by)').eq('clinic_id',clinicId).eq('id',id).single();
      if(error) throw error;
      return {item:map(data),answers:[...(data.appointment_answers || [])].sort((a,b)=>new Date(a.recorded_at)-new Date(b.recorded_at))};
    },
    async create(item) {
      requireClinic(); const {data,error} = await client.from('appointments').insert({clinic_id:clinicId,created_by:userId,
        patient_label:item.patient,age:item.age === '' ? null : Number(item.age),report:item.report,report_source:item.reportSource})
        .select().single();
      if(error) throw error; return map(data);
    },
    async answers(id) {
      requireClinic(); const {data,error} = await client.from('appointment_answers').select('id,question,answer,recorded_at,recorded_by').eq('appointment_id',id).order('recorded_at');
      if(error) throw error; return data;
    },
    async saveAnswers(id, answers, summary) {
      requireClinic(); await rpc('save_appointment_answers',{p_id:id,p_answers:answers,p_summary:summary});
      return this.get(id);
    },
    async summarize(id,regenerate=false) {
      requireClinic();
      if ((await this.answers(id)).length) return rpc('consolidate_appointment',{p_id:id});
      const session = await this.session();
      if(!session) throw new Error('Entre novamente para gerar a ficha.');
      const response=await fetch(`/api/appointments/${encodeURIComponent(id)}/analysis`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({regenerate})});
      const data=await response.json().catch(()=>null);
      if(!response.ok) throw new Error(data?.error || 'Não foi possível acessar a IA. Tente novamente.');
      if(typeof data?.summary !== 'string') throw new Error('A IA não retornou uma ficha válida.');
      return data.summary;
    },
    async pdf(id) {
      requireClinic();
      const session = await this.session();
      if (!session) throw new Error('Entre novamente para baixar o PDF.');
      const response = await fetch(`/api/appointments/${encodeURIComponent(id)}/pdf`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Não foi possível gerar o PDF. Tente novamente.');
      }
      if (!response.headers.get('Content-Type')?.startsWith('application/pdf')) throw new Error('O servidor não retornou um PDF válido. Reinicie o servidor Python.');
      return response.blob();
    },
    async updatePriority(item, priority, assessor, reason) {
      requireClinic();
      const {data,error}=await client.from('appointments').update({priority,priority_assessor:assessor.trim() || null,priority_reason:reason.trim() || null})
        .eq('clinic_id',clinicId).eq('id',item.id).eq('updated_at',item.updatedAt).select().single();
      if(error) throw new Error(error.code==='PGRST116' ? 'O atendimento mudou. Atualize a lista antes de salvar a prioridade.' : error.message);
      return map(data);
    },
    async updateStatus(item,status) {
      requireClinic(); const {data,error}=await client.from('appointments').update({status}).eq('clinic_id',clinicId).eq('id',item.id).eq('updated_at',item.updatedAt).select().single();
      if(error) throw new Error(error.code === 'PGRST116' ? 'O atendimento mudou. Atualize a lista antes de alterar o status.' : error.message); return map(data);
    },
    async remove(item) {
      requireClinic(); const {data,error}=await client.from('appointments').delete().eq('clinic_id',clinicId).eq('id',item.id).eq('updated_at',item.updatedAt).select('id');
      if(error) throw error; if(data.length!==1) throw new Error('O atendimento mudou ou seu acesso foi removido. Atualize a lista antes de excluir.');
    },
    createClinic: (name,email)=>rpc('create_clinic',{p_name:name,p_owner_email:email}),
    setClinicActive: (id,active)=>rpc('set_clinic_active',{p_id:id,p_active:active}),
    team: id=>rpc('list_clinic_team',{p_clinic:id}),
    addMember: (id,email,role)=>rpc('add_clinic_member',{p_clinic:id,p_email:email,p_role:role}),
    removeMember: (id,user)=>rpc('remove_clinic_member',{p_clinic:id,p_user:user}),
  };
})();
