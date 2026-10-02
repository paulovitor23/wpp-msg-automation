import test from 'node:test';
import assert from 'node:assert/strict';
import { dayWindow } from '../src/config.js';
import { findNewsletter, type Mailbox, type MessageData } from '../src/gmail/client.js';

const config = { sender: 'newsletter@example.com', editionDate: '2026-10-02', ...dayWindow('2026-10-02', 'America/Sao_Paulo') };
const html = '<h5>um passo por dia</h5><p>bom dia. cada pequeno passo conta para construir o seu futuro.</p><h5>….</h5><h6>SEXTA-FEIRA, 2 DE OUTUBRO DE 2026</h6>';
function message(id = 'one', body = html, sender = config.sender): MessageData {
  return { id, internalDate: config.start + 3600000, raw: Buffer.from(`From: ${sender}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body}`).toString('base64url') };
}
function mailbox(messages: MessageData[]): Mailbox {
  return { list: async () => ({ ids: messages.map(m => m.id) }), get: async id => messages.find(m => m.id === id)! };
}
test('São Paulo day starts at 03:00 UTC', () => {
  assert.equal(new Date(config.start).toISOString(), '2026-10-02T03:00:00.000Z');
  assert.equal(config.end - config.start, 86400000);
});
test('invalid calendar date and timezone are rejected', () => {
  assert.throws(() => dayWindow('2026-02-30', 'America/Sao_Paulo'));
  assert.throws(() => dayWindow('2026-10-02', 'invalid'));
});
test('fetches raw message and validates newsletter', async () => {
  const result = await findNewsletter(mailbox([message()]), config);
  assert.equal(result?.gmailId, 'one');
  assert.equal(result?.newsletter.editionDate, config.editionDate);
});
test('empty mailbox returns null', async () => {
  assert.equal(await findNewsletter(mailbox([]), config), null);
});
test('wrong sender and messages outside local day are ignored', async () => {
  assert.equal(await findNewsletter(mailbox([
    message('wrong', html, 'other@example.com'),
    { ...message('old'), internalDate: config.start - 1 },
    { ...message('tomorrow'), internalDate: config.end },
  ]), config), null);
});
test('invalid format and wrong edition date fail closed', async () => {
  await assert.rejects(findNewsletter(mailbox([message('bad', '<p>promoção</p>')]), config), /validação/);
  await assert.rejects(findNewsletter(mailbox([message('old', html.replace('2 DE', '1 DE'))]), config), /validação/);
});
test('multiple valid editions are ambiguous', async () => {
  await assert.rejects(findNewsletter(mailbox([message('one'), message('two')]), config), /Mais de uma/);
});
test('paginates and deduplicates IDs; query uses epoch bounds', async () => {
  const calls: (string | undefined)[] = [];
  const mock: Mailbox = {
    async list(query, token) {
      assert.match(query, /from:newsletter@example.com after:\d+ before:\d+/);
      calls.push(token);
      return token ? { ids: ['one'] } : { ids: ['one'], nextPageToken: 'next' };
    }, get: async () => message(),
  };
  assert.equal((await findNewsletter(mock, config))?.gmailId, 'one');
  assert.deepEqual(calls, [undefined, 'next']);
});
test('API failure is not treated as empty mailbox', async () => {
  await assert.rejects(findNewsletter({ list: async () => { throw new Error('offline'); }, get: async () => message() }, config), /offline/);
});
