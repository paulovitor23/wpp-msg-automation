import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { firestoreStores } from '../../src/storage/firestore.js';
import { sendEmails } from '../../src/delivery/email.js';
import { cloudStatus } from '../../src/cloud/status.js';
import { firestorePhraseReader } from '../../src/web/phrases.js';

// Refuse to run against a real project, including when a developer has ADC credentials.
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Inicie o emulador local antes dos testes de integração.');
const projectId='demo-agoniados-tests';
const phrase={title:'um novo dia',message:'bom dia. cada pequeno passo conta para construir o futuro.',editionDate:'2026-10-26'};

test('real SDK transactions: concurrent jobs, restart, source uniqueness and persisted phrase', {timeout:60000}, async()=>{
  const db=new Firestore({projectId});const namespace=`test-${randomUUID()}`;
  const {history,emails}=firestoreStores(db,namespace);
  try {
    const claims=await Promise.all(Array.from({length:4},()=>history.claimRun(phrase.editionDate,'2026-10-26T06:10')));
    assert.equal(claims.filter(Boolean).length,1);
    await history.finishRun(phrase.editionDate,'2026-10-26T06:10','not_found','Aguardando');
    assert.equal(await history.claimRun(phrase.editionDate,'2026-10-26T06:10'),false);
    assert.equal(await history.claimRun(phrase.editionDate,'2026-10-26T06:15'),true);
    await history.savePhrase(phrase.editionDate,'source',phrase);
    let sent=0;
    const deliver=()=>sendEmails(emails,'sender@example.com',['a@example.com'],'source',phrase,async()=>{sent++;return 'message-id';},phrase.editionDate);
    await Promise.all([deliver(),deliver(),deliver()]);assert.equal(sent,1);
    const restarted=firestoreStores(db,namespace);
    assert.equal(await restarted.emails.claim('sender@example.com','a@example.com',phrase.editionDate,'source'),'sent');
    assert.equal(await restarted.emails.claim('sender@example.com','a@example.com','2026-10-27','source'),'source_already_claimed');
    await history.finishRun(phrase.editionDate,'2026-10-26T06:15','emails_sent','ok');
    assert.equal(await history.claimRun(phrase.editionDate,'2026-10-26T06:20'),false);
    const status=await cloudStatus(db,namespace,phrase.editionDate);
    assert.equal(status.status,'emails_sent');assert.equal(status.attempts.length,2);assert.equal(status.deliveries[0].messageId,'message-id');
    assert.deepEqual(await firestorePhraseReader(db,namespace,()=>phrase.editionDate)(),phrase);
    const days=db.collection('automations').doc(namespace).collection('days');
    await days.doc('2026-10-27').set({status:'not_found'});
    await days.doc('2026-10-28').set({newsletter:{...phrase,editionDate:'2026-10-28'}});
    const fallback=await firestorePhraseReader(db,namespace,()=> '2026-10-27')();
    assert.equal(fallback?.editionDate,phrase.editionDate);assert.match(fallback?.notice??'',/última frase salva/);

  } finally {await db.recursiveDelete(db.collection('automations').doc(namespace));await db.terminate();}
});

test('interrupted delivery and storage failure block retry with the real SDK', {timeout:60000},async()=>{
  const db=new Firestore({projectId});const namespace=`test-${randomUUID()}`;
  const {emails,history}=firestoreStores(db,namespace);
  try {
    let sent=0;
    await history.claimRun(phrase.editionDate,'2026-10-26T06:10');
    const result=await sendEmails(emails,'sender@example.com',['a@example.com','b@example.com'],'source',phrase,async()=>{sent++;throw new Error('timeout');},phrase.editionDate);
    assert.equal(result[0].status,'uncertain');assert.equal(sent,1);
    assert.equal(await emails.claim('sender@example.com','a@example.com',phrase.editionDate,'source'),'uncertain');
    assert.equal(await history.claimRun(phrase.editionDate,'2026-10-26T06:15'),false);
    const failing={...emails,finish:async()=>{throw new Error('cannot persist confirmation');}};
    await assert.rejects(sendEmails(failing,'sender@example.com',['c@example.com'],'source',phrase,async()=>{sent++;return 'accepted';},phrase.editionDate));
    const retry=await sendEmails(emails,'sender@example.com',['c@example.com'],'source',phrase,async()=>{sent++;return 'duplicate';},phrase.editionDate);
    assert.equal(retry[0].status,'skipped:sending');assert.equal(sent,2);
  } finally {await db.recursiveDelete(db.collection('automations').doc(namespace));await db.terminate();}
});
