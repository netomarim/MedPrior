import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture({deferAdmin=false, conflict=false, invalidConfig=false, authError=null}={}) {
  const queries=[];
  const authCalls=[];
  let resolveAdmin;
  const pending=new Promise(resolve=>{resolveAdmin=resolve;});
  const row={id:'appointment-one',clinic_id:'clinic-one',patient_label:'Paciente',report:'Relato fictício',status:'Em atendimento',updated_at:'current-version',created_at:'2026-11-21T12:00:00Z'};
  const client={
    auth:{getSession:async()=>({data:{session:null},error:null}),
      async resetPasswordForEmail(...args){authCalls.push(['reset',...args]);return {error:authError};},
      async updateUser(...args){authCalls.push(['update',...args]);return {error:authError};}},
    rpc:async()=>deferAdmin ? pending : {data:true,error:null},
    from(table){
      const query={table,operations:[]};queries.push(query);
      const results=()=>({data:table==='clinics' ? [{id:'clinic-one',name:'Clínica fictícia',active:true}] : table==='clinic_members' ? [{clinic_id:'clinic-one',role:'owner'}] : [],error:null});
      const chain={};
      for(const op of ['select','eq','neq','order','range','limit','update','delete']) chain[op]=(...args)=>{query.operations.push([op,...args]);return chain;};
      chain.then=(resolve,reject)=>Promise.resolve(results()).then(resolve,reject);
      chain.single=async()=>conflict ? {data:null,error:{code:'PGRST116',message:'technical response'}} : {data:row,error:null};
      return chain;
    },
  };
  const context={window:{location:{origin:'http://127.0.0.1:3000',hash:''},MEDPRIOR_CONFIG:invalidConfig?{}:{supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public-test-key'},supabase:{createClient:()=>client}}};
  vm.runInNewContext(fs.readFileSync(new URL('../cloud.js',import.meta.url),'utf8'),context);
  return {cloud:context.window.MedPriorCloud,queries,resolveAdmin,authCalls,client};
}

test('password change verifies current credentials before updating the authenticated account',async()=>{
 const {cloud,client,authCalls}=fixture();await cloud.bind({id:'user-one'});
 client.auth.getUser=async()=>({data:{user:{id:'user-one',email:'test@example.test'}}});
 client.auth.signInWithPassword=async credentials=>{authCalls.push(['verify',credentials]);return {data:{user:{id:'user-one'}}};};
 await cloud.changePassword('current-test-password','replacement-test-password');
 assert.equal(authCalls[0][0],'verify');assert.equal(authCalls[0][1].password,'current-test-password');
 assert.equal(authCalls[1][0],'update');assert.equal(authCalls[1][1].password,'replacement-test-password');
});
test('wrong current password and changed account never update the password',async()=>{
 const {cloud,client,authCalls}=fixture();await cloud.bind({id:'user-one'});
 client.auth.getUser=async()=>({data:{user:{id:'user-one',email:'test@example.test'}}});
 client.auth.signInWithPassword=async()=>({error:{code:'invalid_credentials'}});
 await assert.rejects(cloud.changePassword('incorrect-test-password','replacement-test-password'),/atual está incorreta/);
 client.auth.signInWithPassword=async()=>({data:{user:{id:'other-user'}}});
 await assert.rejects(cloud.changePassword('current-test-password','replacement-test-password'),/sessão mudou/);
 assert.equal(authCalls.length,0);
});
test('password change rejects short and repeated passwords before authentication',async()=>{
 const {cloud,authCalls}=fixture();
 await assert.rejects(cloud.changePassword('current-test-password','short'),/12 caracteres/);
 await assert.rejects(cloud.changePassword('current-test-password','current-test-password'),/diferente/);
 assert.equal(authCalls.length,0);
});

test('patient names accept letters, accents and spaces, but reject digits and punctuation',()=>{
 const {cloud}=fixture();
 for(const patient of ['Ana Maria','João da Conceição','Érica','Jose\u0301']) assert.equal(cloud.validateAppointment({patient,report:'Dor há 3 dias.'}).errors.patient,undefined);
 for(const patient of ['Ana!!!','Ana123','123','Ana-Maria',"D’Ávila",'😀','   ']) assert.ok(cloud.validateAppointment({patient,report:'Dor'}).errors.patient);
 assert.equal(cloud.validateAppointment({patient:'Jose\u0301',report:'Dor'}).patient,'José');
});
test('reports require at least one letter and allow clinical numbers with text',async()=>{
 const {cloud,queries}=fixture();
 for(const report of ['56565656565556665566','123 !!!','...','   ']) {
   assert.ok(cloud.validateAppointment({patient:'Ana',report}).errors.report);
   await assert.rejects(cloud.create({patient:'Ana',report}),/pelo menos uma letra/);
 }
 for(const report of ['Dor há 3 dias','Febre 38,5 °C','a']) assert.equal(cloud.validateAppointment({patient:'Ana',report}).errors.report,undefined);
 await assert.rejects(cloud.create({patient:'Ana!!!',report:'Dor'}),/somente letras/);
 assert.equal(queries.length,0);
});
test('clinic names require a letter before calling the database',async()=>{
 const {cloud,client}=fixture();const calls=[];
 client.rpc=async(name,args)=>{calls.push({name,args});return {data:'clinic-id'};};
 for(const name of ['222222','123 !!!','   ','---']) await assert.rejects(cloud.createClinic(name,'test@example.test'),/pelo menos uma letra/);
 assert.equal(calls.length,0);
 for(const name of ['Clínica 24 Horas','Saúde','São José']) await cloud.createClinic(name,'test@example.test');
 assert.equal(calls.length,3);assert.equal(calls[0].args.p_name,'Clínica 24 Horas');
});
test('a bind finishing after logout cannot restore the old account access',async()=>{
  const {cloud,resolveAdmin}=fixture({deferAdmin:true});
  const binding=cloud.bind({id:'old-user'});
  cloud.clear(); resolveAdmin({data:true,error:null});
  await assert.rejects(binding,/acesso mudou/);
  assert.equal(cloud.userId,null);assert.equal(cloud.access.isAdmin,false);
});
test('queue excludes finalized records and orders oldest arrivals first',async()=>{
  const {cloud,queries}=fixture();
  await cloud.bind({id:'user-one'});cloud.selectClinic('clinic-one');await cloud.queue();
  const ops=queries.at(-1).operations;
  assert.ok(ops.some(op=>op[0]==='neq'&&op[1]==='status'&&op[2]==='Finalizado'));
  assert.ok(ops.some(op=>op[0]==='order'&&op[1]==='created_at'&&op[2].ascending===true));
});
test('status changes use the version read in the detail',async()=>{
  const {cloud,queries}=fixture();
  await cloud.bind({id:'user-one'});cloud.selectClinic('clinic-one');
  await cloud.updateStatus({id:'appointment-one',updatedAt:'expected-version'},'Em atendimento');
  assert.ok(queries.at(-1).operations.some(op=>op[0]==='eq'&&op[1]==='updated_at'&&op[2]==='expected-version'));
});
test('a concurrent status change returns a useful conflict message',async()=>{
  const {cloud}=fixture({conflict:true});
  await cloud.bind({id:'user-one'});cloud.selectClinic('clinic-one');
  await assert.rejects(cloud.updateStatus({id:'one',updatedAt:'old'},'Finalizado'),/atendimento mudou/);
});
test('delete also checks the last version of the appointment',async()=>{
  const {cloud,queries}=fixture();
  await cloud.bind({id:'user-one'});cloud.selectClinic('clinic-one');
  await assert.rejects(cloud.remove({id:'one',updatedAt:'old'}),/atendimento mudou/);
  assert.ok(queries.at(-1).operations.some(op=>op[0]==='eq'&&op[1]==='updated_at'&&op[2]==='old'));
});
test('missing configuration produces a clear error instead of stopping script evaluation',async()=>{
  const {cloud}=fixture({invalidConfig:true});
  assert.equal(cloud.client,null);
  await assert.rejects(cloud.session(),/Configure a URL/);
});

test('detail reads the appointment and its answers in the same query',async()=>{
 const {cloud,queries}=fixture();
 await cloud.bind({id:'user-one'});cloud.selectClinic('clinic-one');
 const detail=await cloud.detail('appointment-one');
 assert.equal(detail.item.id,'appointment-one');
 assert.equal(detail.answers.length,0);
 assert.ok(queries.at(-1).operations.some(op=>op[0]==='select'&&op[1].includes('appointment_answers(')));
});

test('password recovery uses current origin and only sends the email to Auth',async()=>{
 const {cloud,authCalls}=fixture();await cloud.requestPasswordReset('member@example.test');
 assert.equal(authCalls[0][1],'member@example.test');
 assert.equal(authCalls[0][2].redirectTo,'http://127.0.0.1:3000/?recovery=1');
});
test('password change uses the authenticated updateUser API and propagates errors',async()=>{
 const {cloud,authCalls}=fixture();await cloud.updatePassword('test-password-123');
 assert.equal(authCalls[0][0],'update');assert.equal(authCalls[0][1].password,'test-password-123');
 const failure=fixture({authError:new Error('expired session')});
 await assert.rejects(failure.cloud.updatePassword('test-password-123'),/expired session/);
 await assert.rejects(failure.cloud.requestPasswordReset('member@example.test'),/expired session/);
});
