import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture({deferAdmin=false, conflict=false, invalidConfig=false}={}) {
  const queries=[];
  let resolveAdmin;
  const pending=new Promise(resolve=>{resolveAdmin=resolve;});
  const row={id:'appointment-one',clinic_id:'clinic-one',patient_label:'Paciente',report:'Relato fictício',status:'Em atendimento',updated_at:'current-version',created_at:'2026-11-21T12:00:00Z'};
  const client={
    auth:{getSession:async()=>({data:{session:null},error:null})},
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
  const context={window:{MEDPRIOR_CONFIG:invalidConfig?{}:{supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public-test-key'},supabase:{createClient:()=>client}}};
  vm.runInNewContext(fs.readFileSync(new URL('../cloud.js',import.meta.url),'utf8'),context);
  return {cloud:context.window.MedPriorCloud,queries,resolveAdmin};
}

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
