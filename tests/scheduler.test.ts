import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { checkScheduled, openHistory, scheduledSlot } from '../src/scheduler.js';
import type { Mailbox } from '../src/gmail/client.js';

test('six slots, retries, persisted processing and next day', async () => {
  const at = (time: string, date = '2026-10-05') => DateTime.fromISO(`${date}T${time}`, { zone: 'America/Sao_Paulo' });
  for (let minute = 0; minute < 60; minute++) {
    assert.equal(Boolean(scheduledSlot(at(`06:${String(minute).padStart(2,'0')}:00`))), [5,10,15,20,25,30].includes(minute));
  }
  assert.equal(scheduledSlot(at('05:05:00')), null);
  assert.equal(scheduledSlot(at('07:05:00')), null);
  assert.equal(scheduledSlot(DateTime.fromISO('2026-10-05T09:30:00Z').setZone('America/Sao_Paulo')), '2026-10-05T06:30');
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
    await run('06:04:59'); assert.equal(calls, 0);
    await run('06:05:00'); await run('06:05:40'); assert.equal(calls, 1);
    db.close(); db = openHistory(join(dir, 'test.sqlite'));
    await run('06:05:50'); assert.equal(calls, 1);
    fail = true; await run('06:10:00'); assert.equal(calls, 2);
    fail = false; available = true; await run('06:15:00'); assert.equal(calls, 3);
    db.close(); db = openHistory(join(dir, 'test.sqlite'));
    await run('06:20:00'); assert.equal(calls, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM processed').get()?.n, 1);
    assert.equal(logs.filter(text => text.includes('Processada')).length, 1);
    available = false; await run('06:30:00','2026-10-06'); assert.equal(calls, 4);
    await run('06:31:00','2026-10-06'); assert.equal(calls, 4);
  } finally { db.close(); await rm(dir, { recursive: true }); }
});
