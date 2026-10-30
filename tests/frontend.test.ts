import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
const source=await readFile(new URL('../frontend/app.js',import.meta.url),'utf8');
const phrase={title:'um novo dia',message:'bom dia. cada pequeno passo conta para construir o futuro.',editionDate:'2026-10-30',notice:'Edição salva.'};
function page(initial:unknown=phrase) {
  let result=initial;
  const elements=new Map<string,any>();
  const get=(selector:string)=>{
    if(!elements.has(selector)) elements.set(selector,{textContent:'',disabled:false,hidden:false,attrs:{},events:{},setAttribute(name:string,value:string){this.attrs[name]=value;},removeAttribute(name:string){delete this.attrs[name];},addEventListener(name:string,handler:()=>Promise<void>){this.events[name]=handler;}});
    return elements.get(selector);
  };
  let copied='';
  runInNewContext(source,{
    document:{querySelector:get},Intl,Date,AbortSignal,
    navigator:{clipboard:{writeText:async(text:string)=>{copied=text;}}},
    fetch:async()=>{if(result instanceof Error)throw result;return {ok:true,json:async()=>result};},
  });
  return {get,set:(value:unknown)=>{result=value;},copy:()=>copied,ready:async()=>{for(let n=0;n<20&&get('#reading').attrs['aria-busy']!=='false';n++)await setImmediate();assert.equal(get('#reading').attrs['aria-busy'],'false');}};
}
test('refresh errors preserve the readable phrase and its edition notice; copying keeps attribution',async()=>{
  const ui=page();await ui.ready();
  ui.set(new Error('offline'));await ui.get('#reload').events.click();
  assert.equal(ui.get('#title').textContent,phrase.title);
  assert.equal(ui.get('#notice').textContent,phrase.notice);
  assert.equal(ui.get('#copy').disabled,false);
  await ui.get('#copy').events.click();
  assert.match(ui.copy(),/Fonte: the news · 30\/10\/2026/);
  assert.equal(ui.get('#copy-label').textContent,'Copiada!');
  assert.equal(ui.get('#notice').textContent,phrase.notice);
});
test('empty/error state can recover and malformed data does not replace the phrase',async()=>{
  const ui=page(null);await ui.ready();assert.equal(ui.get('#copy').disabled,true);
  ui.set(phrase);await ui.get('#reload').events.click();assert.equal(ui.get('#copy').disabled,false);
  ui.set({...phrase,title:'invalid',editionDate:'2026-02-30'});await ui.get('#reload').events.click();
  assert.equal(ui.get('#title').textContent,phrase.title);assert.match(ui.get('#status').textContent,/inválida/);
});
