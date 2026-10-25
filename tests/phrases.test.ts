import test from 'node:test';
import assert from 'node:assert/strict';
import { openHistory } from '../src/scheduler.js';
import { localPhraseReader, publicPhrase, firestorePhraseReader } from '../src/web/phrases.js';
import type { Firestore } from '@google-cloud/firestore';
const phrase={title:'um novo dia',message:'bom dia. cada pequeno passo conta para construir o futuro.',editionDate:'2026-10-24'};
test('saved phrase survives lookups failing and fresh data is persisted without duplicate processing',async()=>{
  const db=openHistory(':memory:');let calls=0;
  const read=localPhraseReader(db,async()=>{calls++;return {gmailId:'one',newsletter:phrase};},()=>phrase.editionDate);
  try {
    assert.deepEqual(await read(),phrase);assert.deepEqual(await read(),phrase);assert.equal(calls,1);
    const unavailable=localPhraseReader(db,async()=>{throw new Error('offline');},()=> '2026-10-25');
    const previous=await unavailable();assert.equal(previous?.editionDate,'2026-10-24');assert.match(previous?.notice??'',/última frase salva/);
    const absent=localPhraseReader(db,async()=>null,()=> '2026-10-25');assert.match((await absent())?.notice??'',/última frase salva/);
  } finally {db.close();}
});
test('empty history, invalid data and private fields are handled safely',async()=>{
  const db=openHistory(':memory:');
  try {
    assert.equal(await localPhraseReader(db,async()=>null,()=>phrase.editionDate)(),null);
    await assert.rejects(localPhraseReader(db,async()=>{throw new Error('offline');},()=>phrase.editionDate));
    assert.deepEqual(publicPhrase({...phrase,recipient:'private@example.com',token:'secret'},phrase.editionDate),phrase);
    for(const value of [null,{}, {...phrase,editionDate:'2026-02-30'}, {...phrase,editionDate:'2099-01-01'}]) assert.throws(()=>publicPhrase(value,phrase.editionDate));
  } finally {db.close();}
});
test('Firestore reader skips failed days and returns only phrase data',async()=>{
  const query:any={where:()=>query,orderBy:()=>query,limit:()=>query,get:async()=>({docs:[{get:()=>undefined},{get:()=>({...phrase,token:'secret'})}]})};
  const db={collection:()=>({doc:()=>({collection:()=>query})})} as unknown as Firestore;
  const result=await firestorePhraseReader(db,'daily-email',()=> '2026-10-25')();
  assert.equal(result?.editionDate,phrase.editionDate);assert.equal('token' in result!,false);assert.match(result?.notice??'',/última frase salva/);
});
