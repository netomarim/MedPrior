import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Executa o app contra os IDs presentes no HTML real. Detecta controles ausentes
// que interrompem a inicialização antes de habilitar o login.
function page() {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const classes = new Set((match[0].match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/));
    const handlers = {};
    const element = { id: match[1], value: '', type:match[0].match(/\btype="([^"]*)"/)?.[1], textContent: '', innerHTML: '', dataset: {}, disabled: /\sdisabled(?:\s|>)/.test(match[0]),
      classList: { add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value), toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); } },
      addEventListener(name, fn) {handlers[name]=fn;}, dispatch(name){return handlers[name]?.({preventDefault(){},currentTarget:this});},
      setAttribute(name,value){this[name]=value;},querySelector(){return {classList:{toggle(){}},disabled:false};},
      reset(){}, showModal(){this.open=true;}, close(){this.open=false;}, closest() { return {classList:this.classList}; } };
    elements.set(element.id, element);
  }
  return { elements, querySelector: selector => selector.startsWith('#') ? elements.get(selector.slice(1)) || null : null,
    querySelectorAll: () => [] };
}

async function start(session = null, options = {}) {
  const document = page();
  const access = {isAdmin:true, clinics:[{id:'clinic-one',name:'Clínica de teste',active:true}], memberships:[{clinic_id:'clinic-one',role:'owner'}]};
  const calls = [];
  const cloud = {
    client:{auth:{onAuthStateChange(fn){this.listener=fn;}}}, access, clinicId:null,recoveryLinkError:options.linkError,
    async requestPasswordReset(email){calls.push(['reset-email',email]);},
    async updatePassword(password){calls.push(['password',password]);if(options.updateError)throw new Error('Falha ao salvar senha.');},
    async logout(){calls.push('logout');},
    session:async()=>{if(options.recoveryEvent)cloud.client.auth.listener('PASSWORD_RECOVERY');return session;},
    clear(){this.clinicId=null;},
    async bind(){return access;},
    selectClinic(id){this.clinicId=id;calls.push('select');},
    async list(){assert.equal(this.clinicId,'clinic-one');calls.push('list');return options.items || [];},
    async queue(){return options.queue || [];},
    async stats(){assert.equal(this.clinicId,'clinic-one');return {total:options.items?.length || 0,waiting:0,progress:0,done_today:0};},
    get canManage(){return true;},
  };
  const context = {document,window:{MedPriorCloud:cloud,scrollTo(){},location:{search:options.recovery?'?recovery=1':'',hash:'',pathname:'/'},history:{replaceState(){}}},Intl,Date,Set,
    setTimeout:()=>0,clearTimeout(){}};
  vm.runInNewContext(fs.readFileSync(new URL('../analysis.js',import.meta.url),'utf8'),context);
  await vm.runInNewContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),context);
  return {document,calls,context};
}

test('no session enables login using the actual HTML',async()=>{
  const {document}=await start();
  assert.equal(document.elements.get('login-submit').disabled,false);
  assert.equal(document.elements.get('login-message').textContent,'');
});
test('restores the account and selects a clinic before loading appointments',async()=>{
  const {document,calls}=await start({user:{id:'test-user',email:'test@example.test'}});
  assert.deepEqual(calls,['select','list']);
  assert.equal(document.elements.get('account-role').textContent,'Superadministrador da plataforma');
  assert.equal(document.elements.get('login-screen').classList.contains('hidden'),true);
  assert.equal(document.elements.get('authenticated-app').classList.contains('hidden'),false);
});

test('queue stays empty when only finalized appointments exist',async()=>{
 const item={id:'one',patient:'Paciente fictício',age:'',report:'Relato fictício',status:'Finalizado',createdAt:'2026-11-21T12:00:00Z'};
 const {document}=await start({user:{id:'test',email:'test@example.test'}},{items:[item],queue:[]});
 assert.equal(document.elements.get('queue-rows').innerHTML,'');
 assert.equal(document.elements.get('queue-empty').classList.contains('hidden'),false);
 assert.ok(document.elements.get('all-rows').innerHTML.includes('Paciente fictício'));
});
test('unsaved priority is detected, including a change to unclassified',async()=>{
 const {document,context}=await start();
 document.elements.set('detail-priority',{value:'urgent'});
 document.elements.set('priority-assessor',{value:'Profissional fictício'});
 document.elements.set('priority-reason',{value:''});
 context.item={priority:'urgent',priorityAssessor:'Profissional fictício',priorityReason:''};
 assert.equal(vm.runInNewContext('hasPriorityDraft(item)',context),false);
 document.elements.get('detail-priority').value='not_assessed';
 assert.equal(vm.runInNewContext('hasPriorityDraft(item)',context),true);
});
test('common login errors are translated without leaking database errors',async()=>{
 const {context}=await start();
 assert.equal(vm.runInNewContext("friendlyError({message:'Invalid login credentials'})",context),'E-mail ou senha incorretos.');
 assert.ok(!vm.runInNewContext("friendlyError({code:'23514',message:'check constraint internal_table'})",context).includes('internal_table'));
});

test('eye toggles password visibility and accessible label without submitting login',async()=>{
 const {document}=await start();const eye=document.elements.get('toggle-login-password'),input=document.elements.get('login-password');
 await eye.dispatch('click');assert.equal(input.type,'text');assert.equal(eye['aria-label'],'Ocultar senha');
 await eye.dispatch('click');assert.equal(input.type,'password');assert.equal(eye['aria-pressed'],'false');
});
test('signup also toggles password visibility accessibly',async()=>{
 const {document}=await start();const eye=document.elements.get('toggle-signup-password'),input=document.elements.get('signup-password');
 await eye.dispatch('click');assert.equal(input.type,'text');assert.equal(eye['aria-label'],'Ocultar senha');
 await eye.dispatch('click');assert.equal(input.type,'password');assert.equal(eye['aria-pressed'],'false');
 const confirmEye=document.elements.get('toggle-signup-password-confirm'),confirmInput=document.elements.get('signup-password-confirm');
 await confirmEye.dispatch('click');assert.equal(confirmInput.type,'text');assert.equal(confirmEye['aria-label'],'Ocultar confirmação de senha');
 await confirmEye.dispatch('click');assert.equal(confirmInput.type,'password');assert.equal(confirmEye['aria-pressed'],'false');
});
test('a recovery session opens password form instead of loading clinic records',async()=>{
 const {document,calls}=await start({user:{id:'one',email:'test@example.test'}},{recovery:true});
 assert.deepEqual(calls,[]);assert.equal(document.elements.get('password-reset-screen').classList.contains('hidden'),false);
 assert.equal(document.elements.get('authenticated-app').classList.contains('hidden'),true);
});
test('expired recovery link returns to login with instructions',async()=>{
 const {document}=await start(null,{recovery:true});
 assert.match(document.elements.get('login-message').textContent,/expirou/);
});
test('mismatched passwords do not reach auth; valid matching password saves and logs out',async()=>{
 const {document,calls}=await start({user:{id:'one'}},{recovery:true});
 const input=document.elements.get('reset-password'),confirm=document.elements.get('reset-password-confirm'),form=document.elements.get('reset-password-form');
 input.value='new-password-123';confirm.value='different-password';await form.dispatch('submit');assert.deepEqual(calls,[]);
 confirm.value=input.value;await form.dispatch('submit');assert.deepEqual(calls,[['password','new-password-123'],'logout']);
 assert.match(document.elements.get('login-message').textContent,/Senha atualizada/);
});
test('failed password update keeps recovery form open',async()=>{
 const {document,calls}=await start({user:{id:'one'}},{recovery:true,updateError:true});
 document.elements.get('reset-password').value='new-password-123';document.elements.get('reset-password-confirm').value='new-password-123';
 await document.elements.get('reset-password-form').dispatch('submit');
 assert.equal(calls.includes('logout'),false);assert.equal(document.elements.get('password-reset-screen').classList.contains('hidden'),false);
 assert.equal(document.elements.get('reset-password-submit').disabled,false);
});
test('SDK recovery event also prevents opening clinic records without query parameters',async()=>{
 const {document,calls}=await start({user:{id:'one'}},{recoveryEvent:true});
 assert.deepEqual(calls,[]);assert.equal(document.elements.get('password-reset-screen').classList.contains('hidden'),false);
});
test('error callback never opens password form for an existing unrelated session',async()=>{
 const {document,calls}=await start({user:{id:'one'}},{recovery:true,linkError:true});
 assert.deepEqual(calls,[]);assert.match(document.elements.get('login-message').textContent,/expirou/);
 assert.equal(document.elements.get('password-reset-screen').classList.contains('hidden'),true);
});
