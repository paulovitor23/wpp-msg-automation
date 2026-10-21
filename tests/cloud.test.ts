import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { cloudSlot, runDailyEmail, type CloudHistory } from '../src/jobs/daily-email.js';
import { NewsletterFormatError } from '../src/failures.js';
import { sendEmails } from '../src/delivery/email.js';
import { firestoreStores } from '../src/storage/firestore.js';
import type { Firestore } from '@google-cloud/firestore';

const now = DateTime.fromISO('2026-10-20T06:10:30', { zone:'America/Sao_Paulo' });
const phrase = { title:'um novo dia', message:'bom dia. cada pequeno passo conta para construir o futuro.', editionDate:'2026-10-20' };

// Serialized transactions model atomic ownership; the SDK/emulator is validated separately at deployment.
function fakeFirestore() {
  const documents = new Map<string, any>();
  const ref = (path: string): any => ({ id:path.split('/').at(-1), path,
    collection: (name: string) => ({doc:(id:string)=>ref(`${path}/${name}/${id}`)}),
    update: async (data: object) => { if(!documents.has(path)) throw new Error('missing'); documents.set(path,{...documents.get(path),...data}); },
  });
  let queue = Promise.resolve();
  const db = {
    collection:(name:string)=>({doc:(id:string)=>ref(`${name}/${id}`)}),
    runTransaction: (fn: (tx:any)=>Promise<any>) => {
      const result = queue.then(async () => {
        const writes: (()=>void)[]=[];
        const value = await fn({
          getAll: async (...refs:any[])=>refs.map(r=>({exists:documents.has(r.path),get:(field:string)=>documents.get(r.path)?.[field]})),
          set:(r:any,data:object)=>writes.push(()=>documents.set(r.path,{...documents.get(r.path),...data})),
          create:(r:any,data:object)=>writes.push(()=>{assert.equal(documents.has(r.path),false);documents.set(r.path,data);}),
        });
        writes.forEach(write=>write()); return value;
      });
      queue=result.then(()=>{},()=>{});return result;
    },
    batch:()=>{
      const writes:(()=>Promise<void>)[]=[];
      return {update:(r:any,data:object)=>writes.push(()=>r.update(data)),commit:async()=>{for(const write of writes) await write();}};
    },
  };
  return {db:db as unknown as Firestore,documents};
}

test('cloud window accepts startup delays and rejects other times',()=>{
  assert.equal(cloudSlot(now.plus({minutes:2})), '2026-10-20T06:10');
  assert.equal(cloudSlot(now.set({minute:30})), '2026-10-20T06:30');
  for(const time of [now.set({minute:9}),now.set({minute:31}),now.set({hour:7})]) assert.equal(cloudSlot(time),null);
});

test('Firestore reservations survive new instances and serialize concurrent executions',async()=>{
  const {db}=fakeFirestore();
  const {history,emails}=firestoreStores(db,'test');
  assert.deepEqual(await Promise.all([history.claimRun(phrase.editionDate,'06:10'),history.claimRun(phrase.editionDate,'06:10')]),[true,false]);
  assert.equal(await history.claimRun(phrase.editionDate,'06:15'),false);
  await history.finishRun(phrase.editionDate,'06:10','not_found','later');
  assert.equal(await history.claimRun(phrase.editionDate,'06:10'),false);
  assert.equal(await history.claimRun(phrase.editionDate,'06:15'),true);
  const args=['sender@example.com','a@example.com',phrase.editionDate,'source'] as const;
  assert.deepEqual(await Promise.all([emails.claim(...args),emails.claim(...args)]),[null,'sending']);
  await emails.finish(args[0],args[1],args[2],'sent','gmail-message');
  const restarted=firestoreStores(db,'test');
  assert.equal(await restarted.emails.claim(...args),'sent');
  assert.equal(await restarted.emails.claim(args[0],args[1],'2026-10-21',args[3]),'source_already_claimed');
});

test('cloud retries missing editions and transient lookup failures then stops after success',async()=>{
  const {db}=fakeFirestore();const {history}=firestoreStores(db,'test');
  let calls=0, sends=0;
  const find=async()=>{calls++;if(calls===1)return null;if(calls===2)throw {code:503};return {gmailId:'one',newsletter:phrase};};
  const deliver=async()=>{sends++;return [{status:'sent'}];};
  for(const [minutes,status] of [[0,'not_found'],[5,'temporary_error'],[10,'emails_sent'],[15,'skipped']] as const) {
    assert.equal((await runDailyEmail({now:now.plus({minutes}),history,find,deliver})).status,status);
  }
  assert.equal(calls,3);assert.equal(sends,1);
});

test('terminal lookup failures and uncertain deliveries block remaining slots',async()=>{
  for(const error of [{code:401},new NewsletterFormatError('invalid')]) {
    const {history}=firestoreStores(fakeFirestore().db,'test');
    let calls=0;
    const find=async()=>{calls++;throw error;};
    const deliver=async()=>{throw new Error('must not send');};
    await runDailyEmail({now,history,find,deliver});
    assert.equal((await runDailyEmail({now:now.plus({minutes:5}),history,find,deliver})).status,'skipped');
    assert.equal(calls,1);
  }
  const {db}=fakeFirestore();const {history,emails}=firestoreStores(db,'test');
  let sends=0;
  const deliver=async()=>sendEmails(emails,'sender@example.com',['a@example.com','b@example.com'],'source',phrase,async()=>{sends++;throw new Error('timeout');},phrase.editionDate);
  const find=async()=>({gmailId:'source',newsletter:phrase});
  assert.equal((await runDailyEmail({now,history,find,deliver})).status,'email_error');
  assert.equal((await runDailyEmail({now:now.plus({minutes:5}),history,find,deliver})).status,'skipped');
  assert.equal(sends,1);
});

test('persistence failures never authorize email; crash locks remain blocked',async()=>{
  const stores=firestoreStores(fakeFirestore().db,'test');
  let sends=0;
  const find=async()=>({gmailId:'one',newsletter:phrase});
  const deliver=async()=>{sends++;return [{status:'sent'}];};
  const history:CloudHistory={...stores.history,savePhrase:async()=>{throw new Error('storage');},finishRun:async()=>{throw new Error('storage');}};
  await assert.rejects(runDailyEmail({now,history,find,deliver}));
  assert.equal(sends,0);
  assert.equal((await runDailyEmail({now:now.plus({minutes:5}),history:stores.history,find,deliver})).status,'skipped');
  const emails={...stores.emails,claim:async()=>{throw new Error('storage');}};
  await assert.rejects(sendEmails(emails,'sender@example.com',['a@example.com'],'source',phrase,async()=>{sends++;return 'id';},phrase.editionDate));
  assert.equal(sends,0);
});

test('failed confirmation persistence cannot cause a second send',async()=>{
  const {emails}=firestoreStores(fakeFirestore().db,'test');
  let sends=0;
  const failing={...emails,finish:async()=>{throw new Error('database unavailable after Gmail accepted');}};
  const send=async()=>{sends++;return 'gmail-id';};
  await assert.rejects(sendEmails(failing,'sender@example.com',['a@example.com'],'source',phrase,send,phrase.editionDate));
  const results=await sendEmails(emails,'sender@example.com',['a@example.com'],'source',phrase,send,phrase.editionDate);
  assert.equal(results[0].status,'skipped:sending');
  assert.equal(sends,1);
});
