import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { openHistory } from '../src/scheduler.js';
import { sendOnce, checkSendAllowed } from '../src/delivery/send.js';

test('daily global limit, 24h spacing, stale editions and persistent uncertainty', async () => {
  const db = openHistory(':memory:');
  const now = DateTime.now().setZone('America/Sao_Paulo');
  const newsletter = { title: 'um novo dia', message: 'bom dia. cada pequeno passo conta para construir o futuro.', editionDate: now.toISODate()! };
  let calls = 0;
  const send = async () => { calls++; return 'message-id'; };
  try {
    await assert.rejects(sendOnce(db, '123@c.us', 'one', newsletter, send, now), /inválido/);
    await assert.rejects(sendOnce(db, '123@g.us', 'old', { ...newsletter, editionDate: '2000-01-01' }, send, now), /data esperada/);
    await sendOnce(db, '123@g.us', 'one', newsletter, send, now);
    await assert.rejects(sendOnce(db, '456@g.us', 'two', newsletter, send, now), /Limite/);
    assert.throws(() => checkSendAllowed(db, now.plus({ hours: 23 })), /Limite/);
    assert.equal(calls, 1);
    const later = now.plus({ days: 2 });
    const next = { ...newsletter, editionDate: later.toISODate()! };
    await assert.rejects(sendOnce(db, '123@g.us', 'next', next, async () => { throw new Error('disconnect'); }, later), /incerto/);
    assert.throws(() => checkSendAllowed(db, later.plus({ days: 10 })), /incerta/);
    assert.equal(db.prepare("SELECT status FROM deliveries WHERE gmail_id='next'").get()?.status, 'uncertain');
  } finally { db.close(); }
});
