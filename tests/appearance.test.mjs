import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=html.match(/<script id="theme-bootstrap">([\s\S]*?)<\/script>/)[1];
function start(saved, dark=false, blocked=false){
  const root={dataset:{},style:{}};
  const media={matches:dark,addEventListener(_,handler){this.change=handler;}};
  const storage=new Map([['medprior.appearance',saved]]);
  const context={document:{documentElement:root,querySelector(){return null;}},window:{matchMedia(){return media;}},localStorage:{getItem(key){if(blocked)throw Error('blocked');return storage.get(key);},setItem(key,value){if(blocked)throw Error('blocked');storage.set(key,value);}}};
  vm.runInNewContext(script,context);
  return {root,media,storage,theme:context.window.MedPriorTheme};
}
test('restores an explicit theme before authentication',()=>{
  const {root,theme}=start('dark');
  assert.equal(root.dataset.theme,'dark');assert.equal(root.style.colorScheme,'dark');assert.equal(theme.preference,'dark');
});
test('system changes follow device appearance only in system mode',()=>{
  const {root,theme,media}=start('system');
  media.matches=true;media.change();assert.equal(root.dataset.theme,'dark');
  theme.set('light');media.change();assert.equal(root.dataset.theme,'light');
});
test('persists theme selection and ignores invalid values',()=>{
  const {theme,root,storage}=start('system');theme.set('dark');theme.set('invalid');
  assert.equal(root.dataset.theme,'dark');assert.equal(storage.get('medprior.appearance'),'dark');
});
test('invalid stored preference and unavailable storage do not break the page',()=>{
  assert.equal(start('invalid',true).root.dataset.theme,'dark');
  const {theme,root}=start(null,false,true);theme.set('dark');assert.equal(root.dataset.theme,'dark');
});
