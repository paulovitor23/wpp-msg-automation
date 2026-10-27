import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cloudConfig, statusDate } from '../src/cloud/config.js';
import { describeFailure, ConfigurationError } from '../src/failures.js';
import { fileURLToPath } from 'node:url';

test('configuration errors remain actionable without leaking provider data',()=>{
  assert.throws(()=>cloudConfig({},true),/desabilitado/);
  assert.throws(()=>cloudConfig({CLOUD_EMAIL_ENABLED:'true'},true),/GOOGLE_CLOUD_PROJECT/);
  assert.throws(()=>cloudConfig({GOOGLE_CLOUD_PROJECT:'valid-project',TIMEZONE:'bad-zone'}),/TIMEZONE/);
  assert.throws(()=>statusDate('2026-02-30','America/Sao_Paulo'),/data válida/);
  assert.equal(describeFailure(new ConfigurationError('Configure GOOGLE_CLOUD_PROJECT.')).code,'configuration_error');
  assert.doesNotMatch(describeFailure(new Error('secret-token')).message,/secret-token/);
});

test('CLI reports missing project and invalid flags before any API access',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'cloud-cli-'));
  try {
    for(const [args,pattern] of [[['--status'],/GOOGLE_CLOUD_PROJECT/],[['--status','--preview'],/exclusivos/],[[],/Envio desabilitado/]] as const) {
      const env={...process.env,GOOGLE_CLOUD_PROJECT:'',CLOUD_EMAIL_ENABLED:'false'};
      const result=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('../src/cloud-cli.ts',import.meta.url)),...args],{cwd,env,encoding:'utf8',timeout:10000});
      assert.equal(result.status,1,result.stderr);assert.match(result.stderr,pattern);
    }
  } finally {await rm(cwd,{recursive:true,force:true});}
});
