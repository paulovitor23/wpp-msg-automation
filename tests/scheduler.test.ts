import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { checkScheduled, openHistory, scheduledSlot } from '../src/scheduler.js';
import type { Mailbox } from '../src/gmail/client.js';

test('bounded daily slots, persisted processing and next day', async () => {
  const at = (time: string, date = '2026-10-05') => DateTime.fromISO(`${date}T${time}`, { zone: 'America/Sao_Paulo' });
  for (let minute = 0; minute < 60; minute++) {
    assert.equal(Boolean(scheduledSlot(at(`06:${String(minute).padStart(2,'0')}:00`))), minute >= 10 && minute <= 30 && minute % 5 === 0);
  }
  assert.equal(scheduledSlot(at('05:05:00')), null);
  assert.equal(scheduledSlot(at('07:05:00')), null);
  assert.equal(scheduledSlot(DateTime.fromISO('2026-10-05T09:10:00Z').setZone('America/Sao_Paulo')), '2026-10-05T06:10');
  const dir = await mkdtemp(join(tmpdir(), 'newsletter-schedule-'));
  let db = openHistory(join(dir, 'test.sqlite'));
  let calls = 0;
  let fail = false;
  let available = false;
  const sender = process.env.NEWSLETTER_SENDER ?? 'created@thenewscc.com.br';
  const mailbox: Mailbox = {
    async list() { calls++; if (fail) throw new Error('offline'); return { ids: available ? ['one'] : [] }; },
    async get() { return { id: 'one', internalDate: at('06:07:00').toMillis(), raw: Buffer.from(
      `From: ${sender}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<h5>um novo dia</h5><p>bom dia. siga em frente e construa um futuro melhor.</p><h6>SEGUNDA-FEIRA, 5 DE OUTUBRO DE 2026</h6>`
    ).toString('base64url') }; },
  };
  const logs: string[] = [];
  const run = (time: string, date?: string) => checkScheduled(db, mailbox, at(time,date), text => logs.push(text));
  try {
    await run('06:09:59'); assert.equal(calls, 0);
    available = true;
    await run('06:10:00'); await run('06:10:40'); assert.equal(calls, 1);
    db.close(); db = openHistory(join(dir, 'test.sqlite'));
    await run('06:10:50'); assert.equal(calls, 1);
    fail = true; await run('06:10:00', '2026-10-06'); assert.equal(calls, 2);
    fail = false; await run('06:10:00', '2026-10-07'); assert.equal(calls, 3);
    db.close(); db = openHistory(join(dir, 'test.sqlite'));
    await run('06:10:00', '2026-10-07'); assert.equal(calls, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM processed').get()?.n, 1);
    assert.equal(logs.filter(text => text.includes('Processada')).length, 1);
    available = false; await run('06:10:00','2026-10-08'); assert.equal(calls, 4);
    await run('06:11:00','2026-10-08'); assert.equal(calls, 4);
  } finally { db.close(); await rm(dir, { recursive: true }); }
});

test('scheduled emails reuse previews, persist failures and do not run outside the slot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scheduled-email-'));
  let db = openHistory(join(dir,'history.sqlite'));
  const now = DateTime.fromISO('2026-10-14T06:10:00', { zone:'America/Sao_Paulo' });
  const newsletter = { title:'um novo dia', message:'bom dia. cada pequeno passo conta para construir o futuro.', editionDate:'2026-10-14' };
  let sent = 0;
  const mailbox: Mailbox = { list: async () => { throw new Error('Cached preview should be reused'); }, get: async () => { throw new Error('unexpected'); } };
  const deliver = async (result: { gmailId: string }) => { assert.equal(result.gmailId, 'cached'); sent++; };
  try {
    db.prepare('INSERT INTO processed(edition_date,gmail_id,newsletter) VALUES (?,?,?)').run(newsletter.editionDate,'cached',JSON.stringify(newsletter));
    db.prepare("INSERT INTO attempts(slot,status) VALUES (?, 'processed')").run('2026-10-14T06:10');
    await checkScheduled(db,mailbox,now.minus({minutes:1}),()=>{},deliver);
    assert.equal(sent,0);
    await checkScheduled(db,mailbox,now,()=>{},deliver);
    assert.equal(sent,1);
    db.close(); db = openHistory(join(dir,'history.sqlite'));
    await checkScheduled(db,mailbox,now,()=>{},deliver);
    assert.equal(sent,1);
    const tomorrow = now.plus({days:1});
    db.prepare('INSERT INTO processed(edition_date,gmail_id,newsletter) VALUES (?,?,?)').run('2026-10-15','next',JSON.stringify({...newsletter,editionDate:'2026-10-15'}));
    await checkScheduled(db,mailbox,tomorrow,()=>{},async()=>{throw new Error('offline');});
    assert.equal(db.prepare("SELECT status FROM attempts WHERE slot='email:2026-10-15T06:10'").get()?.status,'email_error');
    await checkScheduled(db,mailbox,tomorrow,()=>{},async()=>{sent++;});
    assert.equal(sent,1);
  } finally { db.close(); await rm(dir,{recursive:true}); }
});


test('late newsletter and temporary failure retry, terminal failures and success stop the day', async () => {
  const now = DateTime.fromISO('2026-10-14T06:10:00', { zone:'America/Sao_Paulo' });
  for (const failure of [null, {code:'ECONNRESET'}, {response:{status:401}}, {response:{status:403}}, new Error('secret')]) {
    const db = openHistory(':memory:');
    let calls = 0;
    const mailbox: Mailbox = { list: async () => { calls++; if(failure) throw failure; return {ids:[]}; }, get: async()=>{throw new Error('unexpected');} };
    try {
      await checkScheduled(db,mailbox,now,()=>{},async()=>{});
      await checkScheduled(db,mailbox,now.plus({seconds:20}),()=>{},async()=>{});
      await checkScheduled(db,mailbox,now.plus({minutes:5}),()=>{},async()=>{});
      assert.equal(calls, !failure || 'code' in failure ? 2 : 1);
      if (!failure || 'code' in failure) {
        const phrase = {title:'um novo dia',message:'bom dia. cada pequeno passo conta para construir o futuro.',editionDate:'2026-10-14'};
        db.prepare('INSERT INTO processed(edition_date,gmail_id,newsletter) VALUES (?,?,?)').run(phrase.editionDate,'cached',JSON.stringify(phrase));
        let sends=0;
        await checkScheduled(db,mailbox,now.plus({minutes:10}),()=>{},async()=>{sends++;});
        await checkScheduled(db,mailbox,now.plus({minutes:15}),()=>{},async()=>{sends++;});
        assert.equal(sends,1);
      }
    } finally {db.close();}
  }
});

test('window ends at 06:30 and uncertain delivery blocks subsequent slots', async () => {
  const now = DateTime.fromISO('2026-10-14T06:10:00', {zone:'America/Sao_Paulo'});
  const db = openHistory(':memory:');
  let calls=0;
  const mailbox: Mailbox = {list:async()=>{calls++;return {ids:[]};},get:async()=>{throw new Error('unexpected');}};
  try {
    for (let minutes=0; minutes<=25; minutes+=5) await checkScheduled(db,mailbox,now.plus({minutes}),()=>{},async()=>{});
    assert.equal(calls,5);
    assert.match(String(db.prepare('SELECT detail FROM attempts ORDER BY slot DESC LIMIT 1').get()?.detail),/Janela encerrada/);
    db.prepare("UPDATE attempts SET status='email_error' WHERE slot=?").run('email:2026-10-14T06:10');
    await checkScheduled(db,mailbox,now.plus({minutes:15}),()=>{},async()=>{throw new Error('should not send');});
    assert.equal(calls,5);
  } finally {db.close();}
});
