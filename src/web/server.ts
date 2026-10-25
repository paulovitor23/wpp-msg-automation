import { mkdir } from 'node:fs/promises';
import { Firestore } from '@google-cloud/firestore';
import { openHistory } from '../scheduler.js';
import { localPhraseReader, firestorePhraseReader } from './phrases.js';
import { describeFailure } from '../failures.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { authorize } from '../gmail/auth.js';
import { createMailbox, findNewsletter } from '../gmail/client.js';
import { gmailConfig } from '../config.js';
import type { Newsletter } from '../newsletter/types.js';

const assets = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/styles.css', ['styles.css','text/css; charset=utf-8']],
  ['/app.js', ['app.js','text/javascript; charset=utf-8']],
]);
export function createWebServer(getPhrase: () => Promise<Newsletter | null>) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    try {
      if (req.url === '/api/phrase') {
        const phrase = await getPhrase();
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify(phrase));
        return;
      }
      const asset = assets.get(req.url ?? '');
      if (!asset) { res.writeHead(404).end('Não encontrado'); return; }
      const content = await readFile(new URL(`../../frontend/${asset[0]}`, import.meta.url));
      res.setHeader('Content-Type',asset[1]);
      res.end(content);
    } catch (error) {
      res.writeHead(503, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: describeFailure(error).message, code: describeFailure(error).code }));
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = '127.0.0.1';
  const port = 3000;
  const source = process.env.PHRASE_SOURCE ?? 'gmail';
  if (!['gmail','firestore'].includes(source)) throw new Error('PHRASE_SOURCE inválida.');
  const today = () => gmailConfig().editionDate;
  let close: () => Promise<void>;
  let read: () => Promise<Newsletter | null>;
  if (source === 'firestore') {
    if (!process.env.GOOGLE_CLOUD_PROJECT) throw new Error('Configure GOOGLE_CLOUD_PROJECT.');
    const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
    read = firestorePhraseReader(db, process.env.CLOUD_JOB_KEY ?? 'daily-email', today);
    close = () => db.terminate();
  } else {
    await mkdir('data', { recursive: true, mode: 0o700 });
    const db = openHistory('data/history.sqlite');
    read = localPhraseReader(db, async () => findNewsletter(createMailbox(await authorize()), gmailConfig()), today);
    close = async () => db.close();
  }
  let cached: Promise<Newsletter | null> | undefined;
  let expires = 0;
  let cachedDate = '';
  const server = createWebServer(async () => {
    const date = today();
    if (!cached || Date.now() >= expires || cachedDate !== date) {
      cachedDate = date;
      expires = Infinity;
      cached = read();
      void cached.then(() => { expires = Date.now() + 30000; }, () => { expires = 0; });
    }
    return cached;
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(() => { void close(); });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', () => { console.error('Não foi possível abrir a página: verifique a configuração e a porta.'); process.exitCode = 1; void close(); });
  server.listen(port, host, () => console.log(`Página disponível em http://${host}:${port}`));
}
