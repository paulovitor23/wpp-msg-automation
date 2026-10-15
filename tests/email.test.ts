import test from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from 'mailparser';
import { openHistory } from '../src/scheduler.js';
import { emailRecipients, composeEmail, sendIndividualEmails } from '../src/delivery/email.js';

test('individual MIME, partial failure and per-recipient deduplication', async () => {
  const newsletter = { title: 'um novo olhar', message: 'bom dia. cada pequeno passo também conta para construir o futuro.', editionDate: '2026-10-14' };
  assert.throws(() => emailRecipients('ok@example.com\r\nBcc: hidden@example.com'));
  assert.deepEqual(emailRecipients('A@example.com,a@example.com'), ['a@example.com']);
  const raw = composeEmail('sender@example.com', 'a@example.com', newsletter);
  const parsed = await simpleParser(Buffer.from(raw,'base64url'));
  assert.equal(Array.isArray(parsed.to) ? 0 : parsed.to?.value.length, 1);
  assert.equal(parsed.cc, undefined); assert.equal(parsed.bcc, undefined);
  assert.match(parsed.text!, /também/);
  const db = openHistory(':memory:');
  const recipients = ['a@example.com','b@example.com','c@example.com'];
  let calls = 0;
  try {
    const first = await sendIndividualEmails(db, 'sender@example.com', recipients, 'source', newsletter, async () => {
      calls++; if(calls === 2) throw new Error('timeout'); return 'id-1';
    }, newsletter.editionDate);
    assert.deepEqual(first.map(x => x.status), ['sent','uncertain']);
    const second = await sendIndividualEmails(db, 'sender@example.com', recipients, 'source', newsletter, async raw => {
      calls++; const mail = await simpleParser(Buffer.from(raw,'base64url'));
      assert.equal(Array.isArray(mail.to) ? '' : mail.to?.value[0].address, 'c@example.com');
      return 'id-3';
    }, newsletter.editionDate);
    assert.deepEqual(second.map(x => x.status), ['skipped:sent','skipped:uncertain','sent']);
    assert.equal(calls,3);
  } finally { db.close(); }
});
