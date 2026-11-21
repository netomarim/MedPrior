// O Supabase SDK gerencia a sessão e a renovação do token.
// Toda consulta usa o usuário autenticado e as políticas RLS do banco.
window.MedPriorCloud = (() => {
  const config = window.MEDPRIOR_CONFIG;
  const client = window.supabase?.createClient(config.supabaseUrl, config.supabasePublishableKey);
  let clinicId = null;
  let userId = null;
  function requireClient() {
    if (!client) throw new Error('Não foi possível carregar a conexão. Confira sua internet e recarregue a página.');
    return client;
  }
  function requireClinic() {
    requireClient();
    if (!clinicId || !userId) throw new Error('Entre em uma conta vinculada à clínica.');
  }
  function map(row) {
    return { id: row.id, patient: row.patient_label, age: row.age ?? '', report: row.report,
      createdAt: row.created_at, status: row.status, aiSummary: row.ai_summary ?? '' };
  }
  async function bind(user) {
    clinicId = null; userId = null;
    const { data, error } = await requireClient().from('clinic_members')
      .select('clinic_id, clinics(id, name)').eq('user_id', user.id);
    if (error) throw error;
    if (!data?.length) throw new Error('Esta conta ainda não está vinculada a uma clínica.');
    // O MVP atende uma clínica por conta; não escolhe silenciosamente outra clínica.
    if (data.length !== 1) throw new Error('Esta conta possui mais de uma clínica. Solicite a configuração do acesso.');
    clinicId = data[0].clinic_id; userId = user.id;
    return data[0].clinics;
  }
  return {
    client, bind,
    async session() { const {data,error} = await requireClient().auth.getSession(); if(error) throw error; return data.session; },
    async login(email, password) { const { data, error } = await requireClient().auth.signInWithPassword({email,password}); if(error) throw error; return data.session; },
    async logout() { const {error} = await requireClient().auth.signOut({scope:'local'}); if(error) throw error; clinicId=null; userId=null; },
    clear() { clinicId=null; userId=null; },
    async list() {
      requireClinic();
      const {data,error} = await client.from('appointments').select('*').eq('clinic_id',clinicId).order('created_at',{ascending:false}).limit(500);
      if(error) throw error; return data.map(map);
    },
    async create(item) {
      requireClinic();
      const {data,error} = await client.from('appointments').insert({clinic_id:clinicId, created_by:userId,
        patient_label:item.patient, age:item.age === '' ? null : Number(item.age), report:item.report})
        .select().single();
      if(error) throw error; return map(data);
    },
    async summarize(id, regenerate = false) {
      requireClinic();
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData.session) throw new Error('Entre novamente para gerar a ficha.');
      const response = await fetch(`/api/appointments/${encodeURIComponent(id)}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify({ regenerate }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível acessar a IA. Confira sua conexão e tente novamente.');
      if (typeof data?.summary !== 'string' || !data.summary.trim()) throw new Error('A IA não retornou um resumo válido.');
      return data.summary;
    },
    async updateStatus(id,status) {
      requireClinic();
      const {data,error} = await client.from('appointments').update({status}).eq('clinic_id',clinicId).eq('id',id).select().single();
      if(error) throw error; return map(data);
    },
    async remove(id) {
      requireClinic();
      const {data,error} = await client.from('appointments').delete().eq('clinic_id',clinicId).eq('id',id).select('id');
      if(error) throw error; if(data.length !== 1) throw new Error('O registro não foi excluído. Atualize a lista.');
    }
  };
})();
