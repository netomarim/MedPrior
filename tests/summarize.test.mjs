import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, parseAnalysis } from '../supabase/functions/summarize-appointment/handler.mjs';

const analysis = {version:2, facts:['Dor de cabeça há dois dias; nega febre.'], gaps:['Evolução não informada.'], questions:['A dor melhorou ou piorou?'], note:'A evolução precisa ser esclarecida.'};
const id = '12345678-1234-1234-1234-123456789abc';
function fixture(options = {}) {
  const state = { requests: [], writes: [] };
  const item = { id, updated_at:'2026-11-21T12:00:00Z', status:'Aguardando', report: 'Relata dor de cabeça há dois dias. Nega febre.', ai_summary: null, ...options.item };
  const db = {
    async rpc(name,args){assert.equal(name,'consolidate_appointment'); assert.equal(args.p_id,id);state.consolidated=true;return {data:JSON.stringify({version:3,phase:'complete',facts:['Relato'],gaps:[],questions:[],recordedAnswers:options.answers,note:'Rodada encerrada.'}),error:null};},
    auth: { getUser: async () => ({ data: { user: options.unauthorized ? null : { id: 'member' } }, error: null }) },
    from: table => {
      if (table === 'appointment_answers') {
        const chain = {select(){return chain;},eq(){return chain;},order(){return chain;},limit:async()=>({data:options.answers || [],error:null})};
        return chain;
      }
      assert.equal(table, 'appointments');
      let write;
      const chain = {
        select() { return chain; }, eq() { return chain; }, is() { return chain; },
        update(value) { write = value; state.writes.push(value); return chain; },
        async maybeSingle() {
          if (write) return { data: options.conflict ? null : { ai_summary: write.ai_summary }, error: options.saveError || null };
          return { data: options.inaccessible ? null : item, error: null };
        },
      };
      return chain;
    },
  };
  const handler = createHandler({
    createClient: (url, key, config) => { state.authorization = config.global.headers.Authorization; return db; },
    env: { get: name => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-key', OPENROUTER_API_KEY: options.noKey ? undefined : 'test-secret' })[name] },
    fetchImpl: async (url, init) => {
      state.requests.push({ url, ...init });
      if (options.timeout) throw new DOMException('timeout', 'TimeoutError');
      return new Response(JSON.stringify(options.providerBody || { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(analysis) } }] }), { status: options.providerStatus || 200 });
    },
  });
  const request = (body = { appointmentId: id }, auth = 'Bearer user-jwt') => new Request('https://example.test', {
    method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body),
  });
  return { handler, state, request };
}

test('preflight accepts browser requests', async () => {
  const { handler } = fixture();
  const r = await handler(new Request('https://example.test', { method: 'OPTIONS' }));
  assert.equal(r.status, 204); assert.match(r.headers.get('Access-Control-Allow-Headers'), /authorization/);
});
test('rejects unsupported methods', async () => {
  const { handler } = fixture(); assert.equal((await handler(new Request('https://example.test'))).status, 405);
});
for (const [name, options, body, auth, status] of [
  ['missing session', {}, { appointmentId: id }, '', 401],
  ['invalid session', { unauthorized: true }, { appointmentId: id }, 'Bearer invalid', 401],
  ['invalid id', {}, { appointmentId: '../arbitrary' }, 'Bearer user-jwt', 400],
  ['another clinic', { inaccessible: true }, { appointmentId: id }, 'Bearer user-jwt', 404],
  ['missing secret', { noKey: true }, { appointmentId: id }, 'Bearer user-jwt', 503],
]) {
  test(name, async () => {
    const { handler, state, request } = fixture(options);
    assert.equal((await handler(request(body, auth))).status, status);
    assert.equal(state.requests.length, 0); assert.equal(state.writes.length, 0);
  });
}
test('reads under user JWT, sends only stored report and saves before success', async () => {
  const { handler, state, request } = fixture();
  const r = await handler(request({ appointmentId: id, report: 'Do not use this browser content', patient: 'Private name' }));
  assert.equal(r.status, 200);
  assert.equal(state.authorization, 'Bearer user-jwt');
  const sent = JSON.parse(state.requests[0].body);
  assert.equal(sent.model, 'openrouter/free');
  assert.equal(JSON.parse(sent.messages[1].content).relato, 'Relata dor de cabeça há dois dias. Nega febre.');
  assert.ok(!state.requests[0].body.includes('Private name'));
  assert.equal((await r.json()).summary, state.writes[0].ai_summary);
});
test('reuses saved summary without provider request', async () => {
  const { handler, state, request } = fixture({ item: { ai_summary: JSON.stringify(analysis) }, noKey: true });
  assert.equal((await (await handler(request())).json()).summary, JSON.stringify(analysis));
  assert.equal(state.requests.length, 0);
});
for (const [name, options, status] of [
  ['rate limit', { providerStatus: 429, providerBody: { error: { code: 429, message: 'private provider info' } } }, 429],
  ['invalid provider key', { providerStatus: 401 }, 503],
  ['insufficient credits', { providerStatus: 402 }, 503],
  ['provider failure', { providerStatus: 500 }, 502],
  ['error inside HTTP 200', { providerBody: { error: { code: 429 } } }, 429],
  ['empty output', { providerBody: { choices: [{ finish_reason: 'stop', message: { content: '' } }] } }, 502],
  ['truncated output', { providerBody: { choices: [{ finish_reason: 'length', message: { content: 'Partial' } }] } }, 502],
  ['oversized output', { providerBody: { choices: [{ finish_reason: 'stop', message: { content: 'a'.repeat(2001) } }] } }, 502],
  ['timeout', { timeout: true }, 504],
  ['save failed', { saveError: { message: 'private database info' } }, 500],
  ['record changed or removed', { conflict: true }, 409],
]) {
  test(name, async () => {
    const { handler, state, request } = fixture(options);
    const r = await handler(request()); assert.equal(r.status, status);
    const text = await r.text();
    assert.ok(!text.includes('private')); assert.ok(!text.includes('test-secret'));
    if (!options.saveError && !options.conflict) assert.equal(state.writes.length, 0);
  });
}


test('legacy summary is upgraded only after new analysis saves', async () => {
  const {handler, state, request} = fixture({item:{ai_summary:'Queixa: texto antigo'}});
  assert.equal((await handler(request())).status,200);
  assert.equal(state.writes.length,1);
  assert.equal(JSON.parse(state.writes[0].ai_summary).version,2);
});
test('explicit regenerate refreshes a cached analysis', async () => {
  const {handler, state, request} = fixture({item:{ai_summary:JSON.stringify(analysis)}});
  assert.equal((await handler(request({appointmentId:id,regenerate:true}))).status,200);
  assert.equal(state.requests.length,1);
});
test('regenerate must be boolean', async () => {
  const {handler, state, request} = fixture();
  assert.equal((await handler(request({appointmentId:id,regenerate:'true'}))).status,400);
  assert.equal(state.requests.length,0);
});
test('rejects incomplete structured analysis', () => {
  assert.equal(parseAnalysis({facts:['x'],questions:['y'],note:'z'}),null);
  assert.deepEqual(parseAnalysis({...analysis,questions:[]}).questions,[]);
  assert.equal(parseAnalysis({...analysis,questions:[{html:'x'}]}),null);
  assert.equal(parseAnalysis({...analysis,note:'a'.repeat(221)}),null);
});

test('saved answers consolidate without another provider request',async()=>{
 const answers=[{question:'Quando começou?',answer:'Há dois dias.'}];
 const {handler,state,request}=fixture({answers,noKey:true,item:{analysis_stale:true,ai_summary:JSON.stringify(analysis)}});
 const response=await handler(request());
 assert.equal(response.status,200);
 const summary=JSON.parse((await response.json()).summary);
 assert.equal(summary.phase,'complete');assert.deepEqual(summary.questions,[]);
 assert.deepEqual(summary.recordedAnswers,answers);
 assert.equal(state.requests.length,0);assert.equal(state.consolidated,true);
});
test('completed appointment rejects regeneration',async()=>{
 const {handler,state,request}=fixture({item:{status:'Finalizado'}});
 assert.equal((await handler(request())).status,409);assert.equal(state.requests.length,0);
});
