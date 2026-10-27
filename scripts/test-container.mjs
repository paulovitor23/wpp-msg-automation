import { spawnSync } from 'node:child_process';
function run(args) {
  const result=spawnSync('docker',args,{stdio:'inherit'});
  if(result.error || result.status!==0) throw new Error('Docker indisponível ou teste da imagem falhou. Inicie o Docker e tente novamente.');
}
try {
  run(['build','-f','deploy/google-cloud/Dockerfile','-t','agoniados-test','.']);
  run(['run','--rm','--network=none','--entrypoint=node','agoniados-test','--import','tsx','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {createWebServer} from './src/web/server.ts';
    import {createRequire} from 'node:module';
    const require=createRequire(import.meta.url);
    assert.throws(()=>require.resolve('whatsapp-web.js'));
    const server=createWebServer(async()=>null,'test-password-123456');
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const url='http://127.0.0.1:'+server.address().port;
    try {
      assert.equal((await fetch(url)).status,401);
      const headers={authorization:'Basic '+Buffer.from('agoniados:test-password-123456').toString('base64')};
      assert.match(await (await fetch(url,{headers})).text(),/Frase dos Agoniados/);
      assert.equal(await (await fetch(url+'/api/phrase',{headers})).json(),null);
      assert.equal((await fetch(url+'/data/token.json',{headers})).status,404);
      console.log('Container smoke test passed without external network.');
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  `]);
} catch(error) {console.error(error.message);process.exitCode=1;}
