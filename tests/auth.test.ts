import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize } from '../src/gmail/auth.js';

test('reads a mounted OAuth token without changing it or accessing Google',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'agoniados-token-'));
  const previous=process.env.GMAIL_TOKEN_PATH;
  try {
    process.env.GMAIL_TOKEN_PATH=join(directory,'token.json');
    await writeFile(process.env.GMAIL_TOKEN_PATH,JSON.stringify({client_id:'test-id',client_secret:'test-secret',refresh_token:'test-refresh'}));
    const client=await authorize();
    assert.equal(client.credentials.refresh_token,'test-refresh');
    for (const value of [{}, null, {client_id: {}, client_secret: 'secret', refresh_token: 123}]) {
      await writeFile(process.env.GMAIL_TOKEN_PATH,JSON.stringify(value));
      await assert.rejects(authorize(),/incompleta/);
    }
  } finally {
    if(previous===undefined) delete process.env.GMAIL_TOKEN_PATH;else process.env.GMAIL_TOKEN_PATH=previous;
    await rm(directory,{recursive:true});
  }
});
