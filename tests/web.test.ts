import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer } from '../src/web/server.js';

test('web serves phrase, protects local files and hides provider errors', async () => {
  let fail = false;
  const phrase = { title: 'um novo dia', message: 'bom dia. continue caminhando.', editionDate: '2026-10-12' };
  const server = createWebServer(async () => { if (fail) throw new Error('secret-token'); return phrase; });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(await (await fetch(base+'/api/phrase')).json(), phrase);
    assert.match(await (await fetch(base)).text(), /Frase dos Agoniados/);
    assert.equal((await fetch(base+'/data/credentials.json')).status, 404);
    assert.equal((await fetch(base+'/api/phrase',{method:'POST'})).status, 405);
    fail = true;
    const response = await fetch(base+'/api/phrase');
    assert.equal(response.status,503);
    assert.doesNotMatch(await response.text(), /secret-token/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('private web requires authentication for assets and phrase API', async()=>{
  let reads=0;
  const server=createWebServer(async()=>{reads++;return null;},'long-test-password');
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    for(const route of ['/','/app.js','/api/phrase']) assert.equal((await fetch(base+route)).status,401);
    assert.equal((await fetch(base+'/api/phrase',{headers:{authorization:'Basic invalid'}})).status,401);
    assert.equal(reads,0);
    const response=await fetch(base+'/api/phrase',{headers:{authorization:`Basic ${Buffer.from('agoniados:long-test-password').toString('base64')}`}});
    assert.equal(response.status,200);assert.equal(reads,1);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
