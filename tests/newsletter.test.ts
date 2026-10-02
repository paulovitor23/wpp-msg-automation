import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHtml, extractEml } from '../src/newsletter/extract.js';
import { formatMessage } from '../src/delivery/format.js';

const message = 'bom dia. cada pequeno passo também conta. continue construindo seu caminho.';
const html = `<table><tr><td><h5><b>um passo por dia</b></h5></td></tr>
<tr><td><p>${message}</p></td></tr><tr><td><h5>….</h5></td></tr>
<tr><td><h6>SEXTA-FEIRA, 2 DE OUTUBRO DE 2026</h6></td></tr>
<tr><td><h6>QUICK TAKES</h6><p>Notícias que não devem ser extraídas.</p></td></tr></table>`;

test('extracts title, paragraph and edition date without following news', () => {
  assert.deepEqual(extractHtml(html), { title: 'um passo por dia', message, editionDate: '2026-10-02' });
  assert.match(formatMessage(extractHtml(html)), /Fonte: the news · 02\/10\/2026$/u);
});
test('handles entities and inline formatting', () => {
  assert.equal(extractHtml(html.replace('cada pequeno', 'cada&nbsp;<b>pequeno</b>')).message, message);
});
for (const [name, changed] of [
  ['missing title', html.replace('<h5><b>um passo por dia</b></h5>', '')],
  ['missing greeting', html.replace('bom dia.', 'olá.')],
  ['missing date', html.replace('SEXTA-FEIRA, 2 DE OUTUBRO DE 2026', '')],
  ['impossible date', html.replace('2 DE OUTUBRO', '31 DE FEVEREIRO')],
  ['duplicate intro', html.replace(`<p>${message}</p>`, `<p>${message}</p><p>${message}</p>`)],
  ['unexpected second paragraph', html.replace('<h5>….</h5>', '<p>Outro parágrafo.</p>')],
  ['oversized message', html.replace(message, `bom dia. ${'a'.repeat(1600)}`)],
  ['contamination', html.replace(message, `${message} QUICK TAKES`)],
] as const) {
  test(`rejects ${name}`, () => assert.throws(() => extractHtml(changed)));
}
test('optionally enforces date; historical local files are allowed by default', () => {
  assert.throws(() => extractHtml(html, '2026-10-03'), /data esperada/u);
  assert.equal(extractHtml(html, '2026-10-02').editionDate, '2026-10-02');
});
test('decodes multipart MIME with base64 HTML', async () => {
  const raw = ['From: Newsletter <newsletter@example.com>', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="sample"', '', '--sample',
    'Content-Type: text/plain; charset=utf-8', '', 'Texto alternativo', '--sample',
    'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(html).toString('base64'), '--sample--', ''].join('\r\n');
  assert.deepEqual(await extractEml(Buffer.from(raw)), extractHtml(html));
});
test('decodes quoted-printable UTF-8 HTML', async () => {
  const encoded = Array.from(Buffer.from(html), byte => `=${byte.toString(16).padStart(2, '0')}`).join('');
  const raw = `MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${encoded}`;
  assert.deepEqual(await extractEml(Buffer.from(raw)), extractHtml(html));
});
test('rejects plain text instead of guessing a structure', async () => {
  await assert.rejects(extractEml(Buffer.from('Content-Type: text/plain\r\n\r\nbom dia.')), /sem HTML/u);
});
