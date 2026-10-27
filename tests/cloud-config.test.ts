import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cloudConfig, statusDate } from '../src/cloud/config.js';
import { describeFailure, ConfigurationError } from '../src/failures.js';
import { deploymentFiles, writeDeployment } from '../src/cloud/deploy.js';
import { fileURLToPath } from 'node:url';

test('configuration errors remain actionable without leaking provider data',()=>{
  assert.throws(()=>cloudConfig({},true),/desabilitado/);
  assert.throws(()=>cloudConfig({CLOUD_EMAIL_ENABLED:'true'},true),/GOOGLE_CLOUD_PROJECT/);
  assert.throws(()=>cloudConfig({GOOGLE_CLOUD_PROJECT:'valid-project',TIMEZONE:'bad-zone'}),/TIMEZONE/);
  assert.throws(()=>statusDate('2026-02-30','America/Sao_Paulo'),/data válida/);
  assert.equal(describeFailure(new ConfigurationError('Configure GOOGLE_CLOUD_PROJECT.')).code,'configuration_error');
  assert.doesNotMatch(describeFailure(new Error('secret-token')).message,/secret-token/);
});

test('deployment config disables sending, isolates secrets and refuses overwrite',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'agoniados-deploy-'));
  try {
    const files=deploymentFiles('valid-project','us-central1','a@example.com,b@example.com');
    assert.equal(JSON.parse(files['worker-env.yaml']).CLOUD_EMAIL_ENABLED,'false');
    assert.equal(JSON.parse(files['web-env.yaml']).GMAIL_TOKEN_PATH,undefined);
    assert.match(files['activate.sh'],/--confirm-local-stopped/);
    assert.doesNotMatch(files['publish.sh'],/scheduler jobs create/);
    assert.throws(()=>deploymentFiles('bad;echo pwned','us-central1','a@example.com'));
    assert.throws(()=>deploymentFiles('valid-project','us-central1;echo','a@example.com'));
    const output=join(dir,'deploy');await writeDeployment(output,files);
    const password=await readFile(join(output,'web-password.txt'),'utf8');
    assert.match(password,/^[a-f0-9]{48}$/);
    assert.equal((await stat(join(output,'web-password.txt'))).mode&0o777,0o600);
    await assert.rejects(writeDeployment(output,files),/já existe/);
    assert.equal(await readFile(join(output,'web-password.txt'),'utf8'),password);
    for(const name of ['provision.sh','publish.sh','activate.sh']) {
      const check=spawnSync('bash',['-n',join(output,name)],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
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
