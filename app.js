let appointments = [];
let queue = [];
let detailItem = null;
let appointmentSaving = false;
const cloud = window.MedPriorCloud;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let currentFilter = 'Todos';
let sessionVersion = 0;
let detailEpoch = 0;
let busy = false;
let toastTimer;
let stats = null;
let passwordRecovery = /(?:[?&]recovery=1|(?:^|[#&])type=recovery)/.test((window.location?.search || '') + (window.location?.hash || ''));
function initials(value) { return value.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join(''); }
function userDisplayName(user) {
  const metadataName = String(user?.user_metadata?.full_name || user?.user_metadata?.name || '').trim();
  if (metadataName) return metadataName;
  const local = String(user?.email || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
  return local ? local.replace(/(^|\s)\p{L}/gu, letter => letter.toLocaleUpperCase('pt-BR')) : 'Usuário';
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function formatTime(iso) { return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
function statusClass(status) { return status === 'Aguardando' ? 'waiting' : status === 'Em atendimento' ? 'progress' : 'done'; }
function rowTemplate(item) {
  const report = escapeHtml(item.report);
  return `<tr><td data-label="Paciente"><div class="patient-cell"><span class="patient-avatar">${escapeHtml(initials(item.patient))}</span><span>${escapeHtml(item.patient)}${item.age !== '' ? `<small class="patient-age">${escapeHtml(item.age)} anos</small>` : ''}</span></div></td><td data-label="Relato" class="report-cell" title="${report}">${report}</td><td data-label="Registrado">${formatTime(item.createdAt)}</td><td data-label="Prioridade"><span class="priority-badge ${escapeHtml(item.priority || 'not_assessed')}">${escapeHtml(window.MedPriorAnalysis.priorities[item.priority] || 'Não classificado')}</span></td><td data-label="Status"><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td><div class="row-actions"><button class="more-button" aria-label="Ver atendimento" data-detail="${item.id}">Abrir</button></div></td></tr>`;
}

function render() {
  $('#stat-waiting').textContent = stats?.waiting ?? appointments.filter(a => a.status === 'Aguardando').length;
  $('#stat-progress').textContent = stats?.progress ?? appointments.filter(a => a.status === 'Em atendimento').length;
  $('#stat-done').textContent = stats?.done_today ?? 0;
  $('#stat-average').textContent = stats?.average_minutes ?? '—';
  $('#nav-count').textContent = stats?.total ?? appointments.length;
  $('#count-all').textContent = stats?.total ?? appointments.length;
  $('#queue-rows').innerHTML = queue.map(rowTemplate).join('');
  $('#queue-empty').classList.toggle('hidden', queue.length > 0);
  $('#queue-rows').closest('.table-wrap').classList.toggle('hidden', !queue.length);
  const query = $('#search-input').value.trim().toLocaleLowerCase('pt-BR');
  const filtered = appointments.filter(a => (currentFilter === 'Todos' || a.status === currentFilter) &&
    (!query || `${a.patient} ${a.report}`.toLocaleLowerCase('pt-BR').includes(query)));
  $('#all-rows').innerHTML = filtered.map(rowTemplate).join('');
  $('#list-empty').classList.toggle('hidden', filtered.length > 0);
  $('#all-rows').closest('.table-wrap').classList.toggle('hidden', !filtered.length);
  $('#load-more').classList.toggle('hidden', !stats || appointments.length >= stats.total);
  $('#loaded-count').textContent = stats && appointments.length < stats.total ? `Exibindo ${appointments.length} de ${stats.total}. Carregue mais para pesquisar os anteriores.` : '';
  $$('[data-detail]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.detail)));
}
async function reloadAppointments() {
  const version = sessionVersion;
  const [items, numbers, activeQueue] = await Promise.all([cloud.list(), cloud.stats(), cloud.queue()]);
  if (version !== sessionVersion) return;
  appointments = items; stats = numbers; queue = activeQueue; render();
}
async function refreshStats() {
  const version = sessionVersion;
  try { const [data, activeQueue] = await Promise.all([cloud.stats(),cloud.queue()]); if (version === sessionVersion) { stats = data; queue = activeQueue; render(); } }
  catch { showToast('Alteração salva. Atualize a lista para conferir os indicadores.'); }
}
function friendlyError(error, fallback = 'Não foi possível concluir. Confira sua conexão e tente novamente.') {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (/Invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/already registered/i.test(message)) return 'Este e-mail já possui uma conta. Use a tela de entrada.';
  if (/password.*at least|weak password/i.test(message)) return 'Escolha uma senha mais forte, com pelo menos 12 caracteres.';
  if (/same_password|different from the old|different password/i.test(error?.code || message)) return 'Escolha uma senha diferente da anterior.';
  if (/otp_expired|expired.*link|invalid.*token/i.test(error?.code || message)) return 'O link de recuperação expirou ou já foi usado. Solicite outro em “Esqueci minha senha”.';
  if (/^(23|42)/.test(error?.code || '')) return fallback;
  if (/Email not confirmed/i.test(message)) return 'Confirme seu e-mail antes de entrar.';
  if (/rate limit|too many requests/i.test(message)) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (/fetch|network|timeout|Failed to|AbortError/i.test(message)) return 'Não foi possível conectar. Confira sua internet e tente novamente.';
  if (/JWT|token.*expired/i.test(message)) return 'Sua sessão expirou. Entre novamente.';
  if (/row.level.security|permission denied/i.test(message)) return 'Seu acesso não permite esta operação. Atualize o acesso.';
  if (/^(invalid|error|cannot|could not|unexpected|syntax|TypeError|ReferenceError)/i.test(message)) return fallback;
  return message || fallback;
}
function resetListState() {
  currentFilter='Todos'; $('#search-input').value='';
  $$('.filter-tab').forEach(button => button.classList.toggle('selected',button.dataset.filter==='Todos'));
}
function hasAnswerDraft() { return $$('#answer-form textarea').some(field => field.value.trim()); }
function hasPriorityDraft(item = detailItem) {
  if (!item || !$('#detail-priority')) return false;
  return $('#detail-priority').value !== item.priority || $('#priority-assessor').value.trim() !== item.priorityAssessor.trim() || $('#priority-reason').value.trim() !== item.priorityReason.trim();
}
function restoreDetailControls() {
  $$('#detail-content button, #detail-content select, #detail-content textarea, #detail-content input').forEach(el => el.disabled=false);
  if (detailItem?.status==='Finalizado') {
    $('#detail-status').disabled=true;
    $$('#priority-form input, #priority-form select, #priority-form textarea').forEach(el=>el.disabled=true);
  }
}
function closeAppointment() {
  if (appointmentSaving) { showToast('Aguarde o atendimento ser salvo.'); return; }
  const form=$('#appointment-form');
  const values=new FormData(form);
  const dirty=['patient','age','report'].some(key=>String(values.get(key)||'').trim());
  if (dirty && !window.confirm('Descartar o atendimento que ainda não foi salvo?')) return;
  form.reset(); $('#appointment-dialog').close();
}
function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 5500);
}
function showView(name) {
  if(name!=='configuracoes')clearAccountPasswordForm();
  if (name === 'clinicas' && !cloud.access.isAdmin) return;
  if (['inicio','atendimentos'].includes(name) && !cloud.clinicId) name = 'no-clinic';
  if (name === 'equipe' && !cloud.access.isAdmin && !cloud.access.memberships.some(m => m.role === 'owner')) return;
  $$('.view').forEach(view => view.classList.toggle('hidden', view.id !== `view-${name}`));
  $$('.nav-item').forEach(item => {const active=item.dataset.view===name;item.classList.toggle('active',active);if(active)item.setAttribute('aria-current','page');else item.removeAttribute?.('aria-current');});
  $('#authenticated-app').classList.remove('menu-open');
  $('#menu-toggle').setAttribute('aria-expanded','false');
  $('#crumb-current').textContent = ({inicio:'Visão geral',atendimentos:'Atendimentos',clinicas:'Clínicas',equipe:'Equipe e acessos',configuracoes:'Configurações','no-clinic':'Meu acesso'})[name];
  if (name === 'equipe') loadTeam();
  window.scrollTo({top:0,behavior:'smooth'});
}
function showAppointmentErrors(errors={}) {
  ['patient','report'].forEach(key=>{$(`#${key}-error`).textContent=errors[key] || '';$(`#appointment-${key}`).setAttribute('aria-invalid',String(Boolean(errors[key])));});
}
function openForm() { if (!cloud.clinicId) return; $('#appointment-form').reset(); showAppointmentErrors(); $('#appointment-dialog').showModal(); }
function closeDetail() {
  if (busy) { showToast('Aguarde a operação terminar.'); return false; }
  const dirty = hasAnswerDraft() || hasPriorityDraft();
  if (dirty && !window.confirm('Fechar e descartar as alterações que ainda não foram salvas?')) return false;
  detailEpoch++; detailItem=null; $('#detail-dialog').close(); return true;
}
function updateItem(item) { appointments = appointments.map(a => a.id === item.id ? item : a); queue = queue.map(a => a.id === item.id ? item : a); render(); }
async function openDetail(id) {
  const epoch = ++detailEpoch; const version = sessionVersion;
  let answers, item;
  try { ({item,answers} = await cloud.detail(id)); }
  catch { if(epoch===detailEpoch && version===sessionVersion) { detailItem=null; $('#detail-dialog').close(); showToast('Não foi possível carregar o atendimento atual. Atualize a lista e tente novamente.'); } return; }
  if (epoch !== detailEpoch || version !== sessionVersion) return;
  detailItem=item; updateItem(item);
  const data = window.MedPriorAnalysis.parse(item.aiSummary);
  const interviewComplete = answers.length > 0;
  const unanswered = (interviewComplete ? [] : data?.questions || []).filter(q => !answers.some(a => a.question === q));
  const closed = item.status === 'Finalizado';
  const sources = {patient:'Paciente',companion:'Acompanhante',staff:'Equipe'};
  const history = answers.length ? `<section class="detail-section"><h3>Respostas registradas</h3>${answers.map(a => `<article class="answer-record"><strong>${escapeHtml(a.question)}</strong><p>${escapeHtml(a.answer)}</p><small>Registrado ${a.recorded_by === cloud.userId ? 'por você' : 'pela equipe'} em ${new Date(a.recorded_at).toLocaleString('pt-BR')}</small></article>`).join('')}</section>` : '';
  const questions = !closed && unanswered.length ? `<form id="answer-form" class="interview-form"><h3>Complete com o paciente</h3><p>Esta é a única rodada de perguntas. Preencha todas as respostas; use “Não informado” quando o paciente não souber responder.</p>${unanswered.map((q,i) => `<label class="field">${escapeHtml(q)}<textarea name="answer-${i}" rows="2" maxlength="500" required placeholder="Resposta informada pelo paciente ou Não informado"></textarea></label>`).join('')}<button type="submit" class="button button-primary">Salvar respostas e atualizar ficha</button></form>` : '';
  $('#detail-content').innerHTML = `<div class="detail-top"><div><p class="eyebrow">PRÉ-ATENDIMENTO</p><h2 class="detail-name">${escapeHtml(item.patient)}</h2><div class="detail-meta">${item.age !== '' ? `${escapeHtml(item.age)} anos · ` : ''}${escapeHtml(sources[item.reportSource] || 'Paciente')} · Registrado ${item.createdBy === cloud.userId ? 'por você' : 'pela equipe'} em ${formatTime(item.createdAt)}</div></div><button class="close-button" id="close-detail" aria-label="Fechar">×</button></div>
    <div class="detail-summary"><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span><span class="priority-badge ${escapeHtml(item.priority || 'not_assessed')}">${escapeHtml(window.MedPriorAnalysis.priorities[item.priority] || 'Não classificado')}</span></div>
    <div class="pdf-actions"><button type="button" class="button button-secondary" id="download-pdf">Baixar PDF para revisão médica</button><small>Inclui apenas as informações já salvas.</small></div>
    <section class="detail-section"><h3>Relato original</h3><div class="detail-report">${escapeHtml(item.report)}</div></section>${data?.version === 3 ? '' : history}
    <div class="ai-card"><div class="ai-card-title">${interviewComplete ? 'Ficha final consolidada' : 'Ficha de pré-atendimento com IA'}</div>${item.analysisStale ? '<p class="ai-stale">Há respostas novas. Atualize a ficha para considerá-las.</p>' : ''}<div id="ai-summary">${window.MedPriorAnalysis.render(item.aiSummary)}</div><p id="ai-message" role="status"></p>${!closed && (!interviewComplete || item.analysisStale || data?.version !== 3) ? `<button class="button button-secondary" id="generate-summary">${interviewComplete ? 'Consolidar respostas salvas' : item.aiSummary ? 'Atualizar perguntas da IA' : 'Gerar perguntas com IA'}</button>` : ''}<div class="ai-demo-label">Confira com o paciente. Conteúdo gerado por IA, sujeito a erros. Não é uma avaliação clínica.</div></div>${questions}
    ${!closed && data && !unanswered.length ? '<p class="field-hint">A rodada de perguntas foi encerrada. Não é necessário responder a novas perguntas.</p>' : ''}
    <form id="priority-form" class="priority-form"><h3>Prioridade informada pela equipe de saúde</h3><p>Registre a classificação feita por profissional habilitado, conforme o protocolo da clínica. A IA não define a urgência.</p><label class="field">Prioridade<select id="detail-priority" ${closed?'disabled':''}>${Object.entries(window.MedPriorAnalysis.priorities).map(([value,label]) => `<option value="${value}" ${item.priority === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">Nome e registro do profissional responsável<input id="priority-assessor" maxlength="120" value="${escapeHtml(item.priorityAssessor)}" ${closed?'disabled':''}></label><label class="field">Observação da classificação (opcional)<textarea id="priority-reason" maxlength="500" rows="2" ${closed?'disabled':''}>${escapeHtml(item.priorityReason)}</textarea></label>${!closed?'<button type="submit" class="button button-secondary">Salvar prioridade</button>':''}${item.priorityRecordedAt?`<small>Registrado em ${new Date(item.priorityRecordedAt).toLocaleString('pt-BR')}</small>`:''}</form>
    <div class="detail-actions">${cloud.canDelete ? '<button class="delete-link" id="delete-appointment">Excluir registro</button>' : '<span>Registro da clínica</span>'}<label>Status <select class="status-select" id="detail-status" ${closed ? 'disabled' : ''}><option value="${item.status}">${item.status}</option>${item.status === 'Aguardando' ? '<option>Em atendimento</option>' : item.status === 'Em atendimento' ? '<option>Finalizado</option>' : ''}</select></label></div><p class="field-hint">${closed ? 'Finalizado: disponível para consulta.' : 'Após finalizar, o relato e as respostas ficam disponíveis somente para consulta.'}</p>`;
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  const controls = disabled => { $$('#detail-content button, #detail-content select, #detail-content textarea, #detail-content input').forEach(el => el.disabled = disabled); };
  async function run(action) {
    if (busy) return; busy = true; controls(true);
    try { await action(); }
    catch (error) { if (version === sessionVersion && epoch === detailEpoch) $('#ai-message').textContent = friendlyError(error); }
    finally { if (version === sessionVersion) { busy = false; if ($('#detail-dialog').open) restoreDetailControls(); } }
  }
  $('#priority-form').addEventListener('submit', event => {
    event.preventDefault();
    const priority=$('#detail-priority').value, assessor=$('#priority-assessor').value, reason=$('#priority-reason').value;
    if (priority !== 'not_assessed' && assessor.trim().length < 3) { $('#ai-message').textContent='Informe o nome e registro do profissional que classificou o atendimento.'; return; }
    run(async()=>{
      const updated=await cloud.updatePriority(detailItem || item,priority,assessor,reason);
      if (version !== sessionVersion) return;
      updateItem(updated); detailItem=updated;
      if (hasAnswerDraft()) { $('#ai-message').textContent='Prioridade salva. As respostas digitadas foram preservadas; salve-as para concluir.'; }
      else await openDetail(id);
      showToast('Prioridade registrada conforme avaliação profissional.');
    });
  });
  $('#close-detail').addEventListener('click', closeDetail);
  $('#download-pdf').addEventListener('click', () => run(async () => {
    if (hasAnswerDraft() || hasPriorityDraft()) throw new Error('Salve as alterações digitadas antes de baixar o PDF.');
    $('#ai-message').textContent = 'Preparando o PDF com os dados salvos...';
    const blob = await cloud.pdf(id);
    if (version !== sessionVersion || epoch !== detailEpoch) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `medprior-atendimento-${id}.pdf`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    $('#ai-message').textContent = 'PDF preparado. Confira o arquivo nos downloads do navegador.';
  }));
  $('#generate-summary')?.addEventListener('click', () => run(async () => {
    if (hasAnswerDraft() || hasPriorityDraft()) throw new Error('Salve as alterações digitadas antes de atualizar a ficha.');
    $('#ai-message').textContent = interviewComplete ? 'Consolidando as respostas salvas...' : 'Gerando perguntas. Se houver falha temporária, uma segunda tentativa será feita automaticamente. Isso pode levar cerca de 40 segundos.';
    await cloud.summarize(id, Boolean(item.aiSummary));
    const updated = await cloud.get(id); if (version !== sessionVersion) return;
    updateItem(updated); await openDetail(id);
  }));
  $('#answer-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const entries = unanswered.map((question,i) => ({question,answer:String(values.get(`answer-${i}`)||'').trim()})).filter(a => a.answer);
    if (entries.length !== unanswered.length) { $('#ai-message').textContent = 'Preencha todas as respostas. Use Não informado quando necessário.'; return; }
    if (hasPriorityDraft()) { $('#ai-message').textContent='Salve a prioridade antes de enviar as respostas.'; return; }
    run(async () => {
      const saved = await cloud.saveAnswers(id, entries, item.aiSummary);
      if (version !== sessionVersion) return;
      updateItem(saved);
      $$('#answer-form textarea').forEach(field => field.value = '');
      $('#ai-message').textContent = 'Respostas e ficha final salvas.';
      await openDetail(id);
    });
  });
  $('#detail-status').addEventListener('change', event => {
    const next = event.target.value;
    if (hasAnswerDraft() || hasPriorityDraft()) { event.target.value=item.status; $('#ai-message').textContent='Salve as alterações digitadas antes de mudar o status.'; return; }
    if (next === 'Finalizado' && (unanswered.length || item.analysisStale) && !window.confirm('Há perguntas sem resposta ou ficha desatualizada. Finalizar mesmo assim?')) { event.target.value=item.status; return; }
    run(async () => {
      const updated = await cloud.updateStatus(item,next); if (version !== sessionVersion) return;
      updateItem(updated); await refreshStats(); await openDetail(id);
    });
  });
  $('#delete-appointment')?.addEventListener('click', () => {
    if (!window.confirm('Excluir este registro fictício e suas respostas? Esta ação não pode ser desfeita.')) return;
    run(async () => {
      await cloud.remove(item); if (version !== sessionVersion) return;
      appointments=appointments.filter(a => a.id!==id); detailEpoch++; $('#detail-dialog').close(); await refreshStats(); render();
    });
  });
}

async function loadTeam() {
  const id = $('#team-clinic').value;
  if (!id) { $('#team-list').textContent='Nenhuma clínica disponível.'; return; }
  const version = sessionVersion;
  $('#team-list').textContent='Carregando equipe...';
  try {
    const members = await cloud.team(id);
    if (version !== sessionVersion || $('#team-clinic').value !== id) return;
    $('#team-list').innerHTML=members.map(m => `<div class="management-row"><span><strong>${escapeHtml(m.email)}</strong><small>${m.role==='owner'?'Administrador da clínica':'Atendente / equipe'}</small></span>${cloud.access.isAdmin || m.role==='staff' ? `<button class="text-button" data-remove-member="${m.user_id}">Remover vínculo</button>` : ''}</div>`).join('');
    $$('[data-remove-member]').forEach(button => button.addEventListener('click',async()=>{
      if (!window.confirm('Remover o acesso desta conta à clínica? Os registros feitos por ela serão preservados.')) return;
      button.disabled=true;
      try { await cloud.removeMember(id,button.dataset.removeMember); await loadTeam(); }
      catch(error) { showToast(friendlyError(error)); button.disabled=false; }
    }));
  } catch(error) { $('#team-list').textContent=friendlyError(error); }
}
function renderAccess() {
  const {isAdmin,clinics,memberships}=cloud.access;
  const work=clinics.filter(c => c.active && memberships.some(m => m.clinic_id===c.id));
  $('#clinic-select').innerHTML=work.length ? work.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('') : '<option value="">Sem clínica ativa</option>';
  $('#clinic-select').value=cloud.clinicId || '';
  $('#account-role').textContent=isAdmin?'Superadministrador da plataforma':!cloud.clinicId?'Sem vínculo operacional ativo':cloud.canManage?'Administrador da clínica':'Equipe da clínica';
  $('#settings-role').textContent=$('#account-role').textContent;
  $('#settings-clinic').textContent=clinics.find(c=>c.id===cloud.clinicId)?.name || 'Sem clínica ativa';
  $('#nav-clinicas').classList.toggle('hidden',!isAdmin);
  const managed=clinics.filter(c => isAdmin || memberships.some(m => m.clinic_id===c.id && m.role==='owner'));
  $('#nav-equipe').classList.toggle('hidden',!managed.length);
  $('#team-clinic').innerHTML=managed.map(c => `<option value="${c.id}">${escapeHtml(c.name)}${c.active?'':' (inativa)'}</option>`).join('');
  if (managed.some(c => c.id===cloud.clinicId)) $('#team-clinic').value=cloud.clinicId;
  $('#owner-option').disabled=!isAdmin; $('#owner-option').hidden=!isAdmin;
  $('#member-role').value='staff';
  $('#clinics-list').innerHTML=clinics.map(c => `<div class="management-row"><span><strong>${escapeHtml(c.name)}</strong><small>${c.active?'Ativa':'Inativa'}</small></span><button class="text-button" data-toggle-clinic="${c.id}" data-active="${c.active}">${c.active?'Desativar':'Reativar'}</button></div>`).join('');
  $$('[data-toggle-clinic]').forEach(button => button.addEventListener('click',async()=>{
    if(!isAdmin) return;
    const active=button.dataset.active!=='true';
    if(!window.confirm(active?'Reativar esta clínica?':'Desativar a clínica e suspender o acesso aos seus atendimentos?'))return;
    button.disabled=true;
    try { await cloud.setClinicActive(button.dataset.toggleClinic,active); await enterSession(await cloud.session(),'clinicas'); }
    catch(error) { showToast(friendlyError(error)); button.disabled=false; }
  }));
  ['#new-from-home','#new-empty','#new-from-list'].forEach(selector => $(selector).disabled=!cloud.clinicId);
}
function showLogin(message='') {
  clearAccountPasswordForm();
  sessionVersion++; detailEpoch++; busy=false; cloud.clear(); appointments=[]; queue=[]; detailItem=null; stats=null; resetListState(); render();
  $$('dialog[open]').forEach(dialog=>dialog.close());
  $('#authenticated-app').classList.add('hidden'); $('#login-screen').classList.remove('hidden'); $('#login-message').textContent=message;
  $('#password-reset-screen').classList.add('hidden');
  $('#login-password').type='password';
  $('#toggle-login-password').setAttribute('aria-label','Mostrar senha');
  $('#toggle-login-password').setAttribute('aria-pressed','false');
  $('.eye-slash',$('#toggle-login-password')).classList.toggle('hidden',true);
}
function showPasswordRecovery(message='') {
  showLogin();
  $('#login-screen').classList.add('hidden'); $('#password-reset-screen').classList.remove('hidden');
  $('#reset-password-message').textContent=message;
}
function clearRecoveryAddress() {
  window.history?.replaceState(null, '', window.location.pathname);
}
async function enterSession(session,view) {
  if(passwordRecovery) {
    if(session) showPasswordRecovery();
    else { passwordRecovery=false; clearRecoveryAddress(); showLogin('O link de recuperação é inválido ou expirou. Solicite outro em “Esqueci minha senha”.'); }
    return;
  }
  if(!session) {showLogin(); return;}
  const previous=cloud.clinicId;
  sessionVersion++; const version=sessionVersion; detailEpoch++;
  $$('dialog[open]').forEach(dialog=>dialog.close());
  appointments=[]; queue=[]; detailItem=null; stats=null; resetListState(); render();
  const access=await cloud.bind(session.user);
  if(version!==sessionVersion)return;
  const available=access.clinics.filter(c=>c.active && access.memberships.some(m=>m.clinic_id===c.id));
  const selected=available.find(c=>c.id===previous)||available[0];
  if(selected) {cloud.selectClinic(selected.id); await reloadAppointments();}
  if(version!==sessionVersion)return;
  const displayName=userDisplayName(session.user);
  renderAccess(); $('#profile-name').textContent=displayName; $('#profile-email').textContent=session.user.email; $('#profile-avatar').textContent=initials(displayName);
  $('#settings-name').textContent=displayName;
  $('#settings-email').textContent=session.user.email || 'Não informado';
  $('#settings-avatar').textContent=initials(displayName);
  $('#login-screen').classList.add('hidden'); $('#authenticated-app').classList.remove('hidden');
  showView(view || (selected?'inicio':access.isAdmin?'clinicas':'no-clinic'));
}
$('#menu-toggle').addEventListener('click',()=>{const open=$('#menu-toggle').getAttribute('aria-expanded')!=='true';$('#authenticated-app').classList.toggle('menu-open',open);$('#menu-toggle').setAttribute('aria-expanded',String(open));});
document.addEventListener?.('keydown',event=>{if(event.key==='Escape' && $('#menu-toggle').getAttribute('aria-expanded')==='true'){$('#authenticated-app').classList.remove('menu-open');$('#menu-toggle').setAttribute('aria-expanded','false');$('#menu-toggle').focus();}});
$$('.nav-item').forEach(item=>item.addEventListener('click',()=>showView(item.dataset.view)));
$$('[data-go]').forEach(item=>item.addEventListener('click',()=>showView(item.dataset.go)));
['#new-from-home','#new-empty','#new-from-list'].forEach(selector=>$(selector).addEventListener('click',openForm));
$('#close-modal').addEventListener('click',closeAppointment);
$('#cancel-modal').addEventListener('click',closeAppointment);
$('#appointment-dialog').addEventListener('cancel',event=>{event.preventDefault();closeAppointment();});
$('#detail-dialog').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
['patient','report'].forEach(key=>$(`#appointment-${key}`).addEventListener('input',()=>{
  const {errors}=cloud.validateAppointment({patient:$('#appointment-patient').value,report:$('#appointment-report').value});
  $(`#${key}-error`).textContent=errors[key] || '';
  $(`#appointment-${key}`).setAttribute('aria-invalid',String(Boolean(errors[key])));
}));
$('#appointment-form').addEventListener('submit',async event=>{
  event.preventDefault(); const form=new FormData(event.currentTarget); const button=event.currentTarget.querySelector('[type="submit"]');
  const {patient,report,errors}=cloud.validateAppointment({patient:form.get('patient'),report:form.get('report')});
  showAppointmentErrors(errors);
  if(Object.keys(errors).length){$(`#appointment-${errors.patient?'patient':'report'}`).focus();return;}
  const version=sessionVersion; appointmentSaving=true; button.disabled=true;
  $('#close-modal').disabled=true; $('#cancel-modal').disabled=true;
  try {
    const item=await cloud.create({patient,report,age:String(form.get('age')||''),reportSource:String(form.get('reportSource'))});
    if(version!==sessionVersion)return;
    appointments.unshift(item); $('#appointment-form').reset(); $('#appointment-dialog').close(); await refreshStats(); showView('inicio'); showToast('Atendimento salvo. Gere as perguntas para complementar o relato.'); await openDetail(item.id);
  }catch(error){showToast(friendlyError(error,'Não foi possível salvar.'));}finally{appointmentSaving=false;button.disabled=false;$('#close-modal').disabled=false;$('#cancel-modal').disabled=false;}
});
$('#search-input').addEventListener('input',render);
$$('.filter-tab').forEach(button=>button.addEventListener('click',()=>{currentFilter=button.dataset.filter;$$('.filter-tab').forEach(t=>t.classList.toggle('selected',t===button));render();}));
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault(); $('#login-submit').disabled=true;
  try {const session=await cloud.login($('#login-email').value.trim(),$('#login-password').value);$('#login-password').value='';await enterSession(session);}
  catch(error){showLogin(friendlyError(error,'Não foi possível entrar.'));}finally{$('#login-submit').disabled=false;}
});
$('#toggle-login-password').addEventListener('click',()=>{
  const input=$('#login-password'), button=$('#toggle-login-password');
  const visible=input.type==='password'; input.type=visible?'text':'password';
  button.setAttribute('aria-label',visible?'Ocultar senha':'Mostrar senha');
  button.setAttribute('aria-pressed',String(visible));
  $('.eye-slash',button).classList.toggle('hidden',!visible);
});
$('#toggle-signup-password').addEventListener('click',()=>{
  const input=$('#signup-password'), button=$('#toggle-signup-password');
  const visible=input.type==='password'; input.type=visible?'text':'password';
  button.setAttribute('aria-label',visible?'Ocultar senha':'Mostrar senha');
  button.setAttribute('aria-pressed',String(visible));
  $('.eye-slash',button).classList.toggle('hidden',!visible);
});
$('#toggle-signup-password-confirm').addEventListener('click',()=>{
  const input=$('#signup-password-confirm'), button=$('#toggle-signup-password-confirm');
  const visible=input.type==='password'; input.type=visible?'text':'password';
  button.setAttribute('aria-label',visible?'Ocultar confirmação de senha':'Mostrar confirmação de senha');
  button.setAttribute('aria-pressed',String(visible));
  $('.eye-slash',button).classList.toggle('hidden',!visible);
});
$('#forgot-password').addEventListener('click',()=>{
  $('#forgot-password-form').reset();$('#recovery-email').value=$('#login-email').value.trim();
  $('#recovery-message').textContent='';$('#forgot-password-dialog').showModal();
});
$('#close-forgot-password').addEventListener('click',()=>$('#forgot-password-dialog').close());
$('#forgot-password-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;
  $('#recovery-message').textContent='Enviando solicitação...';
  try {await cloud.requestPasswordReset($('#recovery-email').value.trim());$('#recovery-message').textContent='Se houver uma conta com esse e-mail, você receberá um link para definir a nova senha. Confira também o spam. Abra o link com este servidor Python em execução.';}
  catch(error){$('#recovery-message').textContent=friendlyError(error);}finally{button.disabled=false;}
});
$('#reset-password-form').addEventListener('submit',async event=>{
  event.preventDefault();const password=$('#reset-password').value;
  if(password.length<12 || password!==$('#reset-password-confirm').value){$('#reset-password-message').textContent='Use pelo menos 12 caracteres e confirme a mesma senha nos dois campos.';return;}
  const button=$('#reset-password-submit');button.disabled=true;$('#cancel-password-reset').disabled=true;
  try {
    await cloud.updatePassword(password);$('#reset-password-form').reset();passwordRecovery=false;clearRecoveryAddress();
    try {await cloud.logout();showLogin('Senha atualizada. Entre com a nova senha.');}
    catch {showLogin('Senha atualizada. Entre com a nova senha.');}
  }catch(error){$('#reset-password-message').textContent=friendlyError(error);}finally{button.disabled=false;$('#cancel-password-reset').disabled=false;}
});
$('#cancel-password-reset').addEventListener('click',async()=>{
  try {await cloud.logout();passwordRecovery=false;clearRecoveryAddress();$('#reset-password-form').reset();showLogin();}
  catch(error){$('#reset-password-message').textContent=friendlyError(error);}
});
$('#logout-button').addEventListener('click',async()=>{if(busy||appointmentSaving){showToast('Aguarde a operação terminar.');return;}if($('#detail-dialog').open&&!closeDetail())return;try{await cloud.logout();showLogin();}catch{showToast('Não foi possível sair.');}});
$('#refresh-appointments').addEventListener('click',async event=>{event.target.disabled=true;try{await reloadAppointments();}catch(error){showToast(friendlyError(error));}finally{event.target.disabled=false;}});
$('#load-more').addEventListener('click',async event=>{
  event.target.disabled=true; const version=sessionVersion;
  try {const more=await cloud.list(appointments.length);if(version===sessionVersion){const ids=new Set(appointments.map(a=>a.id));appointments.push(...more.filter(a=>!ids.has(a.id)));render();}}
  catch(error){showToast(friendlyError(error));}finally{event.target.disabled=false;}
});
$('#clinic-select').addEventListener('change',async event=>{
  const previous=cloud.clinicId;
  if(busy || ($('#detail-dialog').open&&!closeDetail())) {event.target.value=previous;return;}
  event.target.disabled=true; sessionVersion++; detailEpoch++; appointments=[];queue=[];detailItem=null;stats=null;resetListState();render();
  try {cloud.selectClinic(event.target.value);await reloadAppointments();renderAccess();showView('inicio');}
  catch(error){showToast(friendlyError(error));showView('no-clinic');}finally{event.target.disabled=false;}
});
$('#refresh-access').addEventListener('click',async event=>{
  if(busy || ($('#detail-dialog').open&&!closeDetail()))return;
  event.target.disabled=true;try{await enterSession(await cloud.session());}catch(error){showLogin(friendlyError(error));}finally{event.target.disabled=false;}
});
function validateClinicName() {
  const valid=/\p{L}/u.test($('#clinic-name').value);
  $('#clinic-name-error').textContent=valid?'':'O nome da clínica deve conter pelo menos uma letra.';
  $('#clinic-name').setAttribute('aria-invalid',String(!valid));
  return valid;
}
$('#clinic-name').addEventListener('input',validateClinicName);
$('#clinic-form').addEventListener('submit',async event=>{
  if(!validateClinicName()){event.preventDefault();$('#clinic-name').focus();return;}
  event.preventDefault();const form=event.currentTarget, data=new FormData(form),button=form.querySelector('button');button.disabled=true;
  try {await cloud.createClinic(String(data.get('name')).trim(),String(data.get('owner')).trim());form.reset();await enterSession(await cloud.session(),'clinicas');$('#clinic-message').textContent='Clínica cadastrada e administrador vinculado.';}
  catch(error){$('#clinic-message').textContent=friendlyError(error);}finally{button.disabled=false;}
});
$('#team-clinic').addEventListener('change',()=>{$('#team-message').textContent='';loadTeam();});
$('#member-form').addEventListener('submit',async event=>{
  event.preventDefault();const data=new FormData(event.currentTarget),button=event.currentTarget.querySelector('button');button.disabled=true;
  try {await cloud.addMember($('#team-clinic').value,String(data.get('email')).trim(),data.get('role'));event.target.reset();$('#team-message').textContent='Acesso vinculado à clínica.';await loadTeam();}
  catch(error){$('#team-message').textContent=friendlyError(error);}finally{button.disabled=false;}
});
$('#open-signup').addEventListener('click',()=>{$('#signup-form').reset();[['#signup-password','#toggle-signup-password','Mostrar senha'],['#signup-password-confirm','#toggle-signup-password-confirm','Mostrar confirmação de senha']].forEach(([inputSelector,buttonSelector,label])=>{const input=$(inputSelector),button=$(buttonSelector);input.type='password';button.setAttribute('aria-label',label);button.setAttribute('aria-pressed','false');$('.eye-slash',button).classList.add('hidden');});$('#signup-message').textContent='';$('#signup-dialog').showModal();});
$('#close-signup').addEventListener('click',()=>$('#signup-dialog').close());
$('#signup-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,data=new FormData(form),button=form.querySelector('[type="submit"]');button.disabled=true;
  if(String(data.get('password'))!==String(data.get('password-confirm'))){$('#signup-message').textContent='As senhas não coincidem. Confira os dois campos.';button.disabled=false;return;}
  try {const result=await cloud.signup(String(data.get('email')).trim(),String(data.get('password')),String(data.get('name')).trim());form.reset();
    if(result.session){$('#signup-dialog').close();await enterSession(result.session);}else{$('#signup-message').textContent='Se o cadastro for aceito, você receberá a confirmação por e-mail. Depois, entre e solicite seu vínculo à clínica.';}}
  catch(error){$('#signup-message').textContent=friendlyError(error);}finally{button.disabled=false;}
});
function clearAccountPasswordForm() {
  $('#account-password-form').reset();
  ['current','new','confirm'].forEach(key=>{$(`#account-password-${key}`).value='';$(`#account-password-${key}`).type='password';});
  $$('.account-password-toggle').forEach(button=>{button.setAttribute('aria-pressed','false');button.setAttribute('aria-label',button.getAttribute('aria-label').replace(/^Ocultar/,'Mostrar'));$('.eye-slash',button).classList.add('hidden');});
  $('#account-password-message').textContent='';
}
$$('.account-password-toggle').forEach(button=>button.addEventListener('click',()=>{
  const input=$(`#${button.getAttribute('aria-controls')}`),visible=input.type==='password';
  input.type=visible?'text':'password';button.setAttribute('aria-pressed',String(visible));
  button.setAttribute('aria-label',button.getAttribute('aria-label').replace(/^(Mostrar|Ocultar)/,visible?'Ocultar':'Mostrar'));
  $('.eye-slash',button).classList.toggle('hidden',!visible);
}));
$('#account-password-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const current=$('#account-password-current').value,password=$('#account-password-new').value,confirm=$('#account-password-confirm').value;
  const message=$('#account-password-message');
  if(password.length<12){message.textContent='Use pelo menos 12 caracteres na nova senha.';return;}
  if(password!==confirm){message.textContent='As senhas não coincidem. Confira a confirmação.';return;}
  if(password===current){message.textContent='Escolha uma senha diferente da atual.';return;}
  if(!current){message.textContent='Informe sua senha atual.';return;}
  const version=sessionVersion;busy=true;
  const controls=$$('#account-password-form input, #account-password-form button');controls.forEach(control=>control.disabled=true);
  message.textContent='Salvando nova senha...';
  try {
    await cloud.changePassword(current,password);
    if(version===sessionVersion){clearAccountPasswordForm();message.textContent='Senha atualizada com sucesso. Use a nova senha no próximo acesso.';}
  }catch(error){
    if(version===sessionVersion){clearAccountPasswordForm();message.textContent=friendlyError(error,'Não foi possível alterar a senha. Tente novamente.');}
  }finally{busy=false;controls.forEach(control=>control.disabled=false);}
});
$$('input[name="appearance"]').forEach(input=>{
  input.checked=input.value===window.MedPriorTheme?.preference;
  input.addEventListener('change',()=>{
    if(!input.checked)return;
    window.MedPriorTheme.set(input.value);
    const labels={light:'Claro',dark:'Escuro',system:'Sistema'};
    $('#theme-message').textContent=`Tema ${labels[input.value]} aplicado. A preferência vale para este navegador.`;
  });
});
$('#about-system').addEventListener('click',event=>{event.preventDefault();$('#help-dialog').showModal();});
window.addEventListener?.('beforeunload',event=>{
  const dirtyDetail=$('#detail-dialog').open && (hasAnswerDraft() || hasPriorityDraft());
  const form=$('#appointment-form');
  const values=form && $('#appointment-dialog').open ? new FormData(form) : null;
  const dirtyNew=values && ['patient','age','report'].some(key=>String(values.get(key)||'').trim());
  if (busy || appointmentSaving || dirtyDetail || dirtyNew) {event.preventDefault();event.returnValue='';}
});
$('#today-label').textContent=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'numeric',month:'long'}).format(new Date()).toLocaleUpperCase('pt-BR');
cloud.client?.auth.onAuthStateChange(event=>{
  // Não chamar métodos Auth assíncronos dentro do callback (lock da sessão).
  if(event==='PASSWORD_RECOVERY'){passwordRecovery=true;showPasswordRecovery();}
  if(event==='SIGNED_OUT' && !passwordRecovery)showLogin('Sua sessão foi encerrada.');
});
render();
(async()=>{
  try {
    if(cloud.recoveryLinkError){
      passwordRecovery=false;clearRecoveryAddress();
      showLogin('O link de recuperação expirou ou é inválido. Solicite outro em “Esqueci minha senha”.');
    } else await enterSession(await cloud.session());
  }catch(error){passwordRecovery=false;showLogin(friendlyError(error,'Não foi possível carregar sua conta.'));}
  finally{$('#login-submit').disabled=!cloud.client;}
})();
