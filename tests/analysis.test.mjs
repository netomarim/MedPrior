import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = {window:{}};
vm.runInNewContext(readFileSync(new URL('../analysis.js', import.meta.url),'utf8'),context);
const render = context.window.MedPriorAnalysis.render;
test('renders all four sections and escapes generated HTML',()=>{
 const html=render(JSON.stringify({version:2,facts:['<img src=x onerror=alert(1)>'],gaps:['Duração não informada'],questions:['Quando começou?'],note:'Confirmar duração.'}));
 for(const title of ['Informações identificadas','Informações que faltam esclarecer','Perguntas para complementar','Sobre este registro']) assert.ok(html.includes(title));
 assert.ok(!html.includes('<img')); assert.ok(html.includes('&lt;img'));
});
test('keeps legacy summary visible and offers upgrade',()=>{
 const html=render('<script>unsafe</script>');
 assert.ok(html.includes('Resumo anterior')); assert.ok(!html.includes('<script>'));
});
test('empty analysis explains its purpose',()=>assert.ok(render('').includes('perguntas')));

test('completed interview shows saved answers without further questions',()=>{
 const html=render(JSON.stringify({version:3,phase:'complete',facts:['Relato'],gaps:[],questions:[],recordedAnswers:[{question:'Quando começou?',answer:'Ontem <script>'}],note:'Rodada encerrada.'}));
 assert.ok(html.includes('Rodada concluída'));assert.ok(html.includes('Ontem &lt;script&gt;'));
 assert.ok(!html.includes('Perguntas para complementar'));
});

test('malformed consolidated answers do not crash the detail',()=>{
 const value=JSON.stringify({version:3,phase:'complete',facts:[],gaps:[],questions:[],recordedAnswers:[null],note:'Stored value'});
 assert.doesNotThrow(()=>render(value));
 assert.equal(context.window.MedPriorAnalysis.parse(value),null);
});
