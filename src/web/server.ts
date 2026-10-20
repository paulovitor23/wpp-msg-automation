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
  // One in-flight request and short cache avoid repeated Gmail calls on page reload.
  let cached: Promise<Newsletter | null> | undefined;
  let expires = 0;
  const server = createWebServer(async () => {
    if (!cached || Date.now() >= expires) {
      expires = Infinity;
      cached = (async () => (await findNewsletter(createMailbox(await authorize()), gmailConfig()))?.newsletter ?? null)();
      void cached.then(() => { expires = Date.now() + 30000; }, () => { expires = 0; });
    }
    return cached;
  });
  server.on('error', () => { console.error('Não foi possível abrir a página: verifique se a porta 3000 já está ocupada.'); process.exitCode = 1; });
  server.listen(3000, '127.0.0.1', () => console.log('Página disponível em http://127.0.0.1:3000'));
}
