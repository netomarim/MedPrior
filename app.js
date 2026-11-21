let appointments = [];
const cloud = window.MedPriorCloud;
let currentFilter = 'Todos';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function reloadAppointments() { appointments = await cloud.list(); render(); }
function initials(value) { return value.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join(''); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function formatTime(iso) { return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
function statusClass(status) { return status === 'Aguardando' ? 'waiting' : status === 'Em atendimento' ? 'progress' : 'done'; }
function rowTemplate(item) {
  const report = escapeHtml(item.report);
  return `<tr><td><div class="patient-cell"><span class="patient-avatar">${escapeHtml(initials(item.patient))}</span><span>${escapeHtml(item.patient)}${item.age ? `<small class="patient-age">${escapeHtml(item.age)} anos</small>` : ''}</span></div></td><td class="report-cell" title="${report}">${report}</td><td>${formatTime(item.createdAt)}</td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td><div class="row-actions"><button class="more-button" aria-label="Ver atendimento" data-detail="${item.id}">···</button></div></td></tr>`;
}
function render() {
  const waiting = appointments.filter(a => a.status === 'Aguardando').length;
  $('#stat-waiting').textContent = waiting;
  $('#stat-progress').textContent = appointments.filter(a => a.status === 'Em atendimento').length;
  $('#stat-done').textContent = appointments.filter(a => a.status === 'Finalizado' && new Date(a.createdAt).toDateString() === new Date().toDateString()).length;
  $('#nav-count').textContent = appointments.length;
  $('#count-all').textContent = appointments.length;
  const recent = [...appointments].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  $('#queue-rows').innerHTML = recent.map(rowTemplate).join('');
  $('#queue-empty').classList.toggle('hidden', appointments.length > 0);
  $('#queue-rows').closest('.table-wrap').classList.toggle('hidden', appointments.length === 0);
  const query = $('#search-input').value.trim().toLocaleLowerCase('pt-BR');
  const filtered = [...appointments].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).filter(a => (currentFilter === 'Todos' || a.status === currentFilter) && (!query || `${a.patient} ${a.report}`.toLocaleLowerCase('pt-BR').includes(query)));
  $('#all-rows').innerHTML = filtered.map(rowTemplate).join('');
  $('#list-empty').classList.toggle('hidden', filtered.length > 0);
  $('#all-rows').closest('.table-wrap').classList.toggle('hidden', filtered.length === 0);
  bindDetailButtons();
}
function showView(name) {
  $$('.view').forEach(view => view.classList.toggle('hidden', view.id !== `view-${name}`));
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === name));
  $('#crumb-current').textContent = name === 'inicio' ? 'Visão geral' : 'Atendimentos';
  window.scrollTo({top: 0, behavior: 'smooth'});
}
function openForm() { $('#appointment-form').reset(); $('#appointment-dialog').showModal(); }
function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2600);
}
function bindDetailButtons() { $$('[data-detail]').forEach(button => button.addEventListener('click', () => openDetail(button.dataset.detail))); }
function openDetail(id) {
  const item = appointments.find(a => a.id === id); if (!item) return;
  $('#detail-content').innerHTML = `<div class="detail-top"><div><p class="eyebrow">PRÉ-ATENDIMENTO</p><h2 class="detail-name">${escapeHtml(item.patient)}</h2><div class="detail-meta">${item.age ? `${escapeHtml(item.age)} anos · ` : ''}Registrado às ${formatTime(item.createdAt)}</div></div><button class="close-button" id="close-detail" aria-label="Fechar">×</button></div><div class="detail-section"><h3>Relato informado</h3><div class="detail-report">${escapeHtml(item.report)}</div></div><div class="ai-card"><div class="ai-card-title">✦ Resumo organizado</div><p>${escapeHtml(item.aiSummary || 'O resumo por IA será habilitado quando a conexão com o serviço estiver configurada. Neste protótipo, revise o relato original acima.')}</p><div class="ai-demo-label">A equipe deve conferir as informações com o paciente. Não é uma avaliação clínica.</div></div><div class="detail-actions"><button class="delete-link" id="delete-appointment">Excluir registro</button><label>Status <select class="status-select" id="detail-status"><option ${item.status==='Aguardando'?'selected':''}>Aguardando</option><option ${item.status==='Em atendimento'?'selected':''}>Em atendimento</option><option ${item.status==='Finalizado'?'selected':''}>Finalizado</option></select></label></div>`;
  $('#detail-dialog').showModal();
  $('#close-detail').addEventListener('click', () => $('#detail-dialog').close());
  $('#detail-status').addEventListener('change', async event => {
    const select = event.target; select.disabled = true;
    try {
      const updated = await cloud.updateStatus(id, select.value);
      appointments = appointments.map(a => a.id === id ? updated : a);
      render(); showToast('Status atualizado.'); $('#detail-dialog').close();
    } catch { select.value = item.status; showToast('Não foi possível atualizar. Confira sua conexão.'); }
    finally { select.disabled = false; }
  });
  $('#delete-appointment').addEventListener('click', async event => {
    if (!window.confirm('Excluir este atendimento de demonstração?')) return;
    event.target.disabled = true;
    try {
      await cloud.remove(id); appointments = appointments.filter(a => a.id !== id);
      render(); $('#detail-dialog').close(); showToast('Registro excluído.');
    } catch { event.target.disabled = false; showToast('Não foi possível excluir. Confira sua conexão.'); }
  });
}

$$('.nav-item').forEach(item => item.addEventListener('click', () => showView(item.dataset.view)));
$$('[data-go]').forEach(item => item.addEventListener('click', () => showView(item.dataset.go)));
['#new-from-home','#new-empty','#new-from-list'].forEach(selector => $(selector).addEventListener('click', openForm));
$('#close-modal').addEventListener('click', () => $('#appointment-dialog').close());
$('#cancel-modal').addEventListener('click', () => $('#appointment-dialog').close());
$('#appointment-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const report = String(form.get('report')).trim();
  const patient = String(form.get('patient')).trim();
  if (!patient || !report) { showToast('Preencha o identificador e o relato.'); return; }
  const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try {
    const item = await cloud.create({patient,report,age:String(form.get('age') || '')});
    appointments.unshift(item); render(); $('#appointment-dialog').close(); showView('inicio'); showToast('Atendimento salvo na clínica.');
  } catch { showToast('Não foi possível salvar. Confira sua conexão e tente novamente.'); }
  finally { button.disabled = false; }
});
$('#search-input').addEventListener('input', render);
$$('.filter-tab').forEach(button => button.addEventListener('click', () => { currentFilter = button.dataset.filter; $$('.filter-tab').forEach(tab => tab.classList.toggle('selected', tab === button)); render(); }));
$('#today-label').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('pt-BR');
render();

function showLogin(message = '') {
  appointments = []; cloud.clear(); render();
  $$('dialog[open]').forEach(dialog => dialog.close());
  $('#authenticated-app').classList.add('hidden'); $('#login-screen').classList.remove('hidden');
  $('#login-message').textContent = message;
}
async function enterSession(session) {
  if (!session) { showLogin(); return; }
  const clinic = await cloud.bind(session.user);
  await reloadAppointments();
  $('.clinic-switch > span:nth-child(2)').textContent = clinic.name;
  $('#profile-email').textContent = session.user.email;
  $('#profile-avatar').textContent = initials(session.user.email.split('@')[0]);
  $('#login-screen').classList.add('hidden'); $('#authenticated-app').classList.remove('hidden');
  showView('inicio');
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('#login-submit'); button.disabled = true;
  $('#login-message').textContent = 'Entrando...';
  try {
    const session = await cloud.login($('#login-email').value.trim(), $('#login-password').value);
    $('#login-password').value = '';
    await enterSession(session);
  } catch (error) {
    showLogin(error.message?.includes('clínica') ? error.message : 'Não foi possível entrar. Confira o e-mail, a senha e sua conexão.');
  } finally { button.disabled = false; }
});
$('#logout-button').addEventListener('click', async () => {
  try { await cloud.logout(); showLogin(); } catch { showToast('Não foi possível sair. Tente novamente.'); }
});
$('#refresh-appointments').addEventListener('click', async event => {
  event.target.disabled = true;
  try { await reloadAppointments(); showToast('Lista atualizada.'); }
  catch { showToast('Não foi possível atualizar a lista.'); }
  finally { event.target.disabled = false; }
});
cloud.client?.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') showLogin('Sua sessão foi encerrada. Entre novamente.');
});
(async () => {
  try { await enterSession(await cloud.session()); }
  catch (error) { showLogin(error.message?.includes('clínica') ? error.message : 'Não foi possível carregar a conta. Confira sua conexão.'); }
  finally { $('#login-submit').disabled = !cloud.client; }
})();
