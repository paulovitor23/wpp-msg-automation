import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { cloudConfig } from './config.js';
import { emailRecipients } from '../delivery/email.js';
import { ConfigurationError } from '../failures.js';

export function deploymentFiles(project: string, region: string, recipients: string) {
  const {projectId,namespace,zone}=cloudConfig({GOOGLE_CLOUD_PROJECT:project});
  if (!/^[a-z]+-[a-z]+\d+$/.test(region)) throw new ConfigurationError('Região inválida. Exemplo: us-central1.');
  let addresses:string[];
  try { addresses=emailRecipients(recipients); } catch {throw new ConfigurationError('Configure EMAIL_RECIPIENTS com um a três e-mails válidos.');}
  const common={GOOGLE_CLOUD_PROJECT:projectId,CLOUD_JOB_KEY:namespace,TIMEZONE:zone};
  const worker={...common,CLOUD_EMAIL_ENABLED:'false',GMAIL_TOKEN_PATH:'/secrets/gmail/token.json',EMAIL_RECIPIENTS:addresses.join(','),NEWSLETTER_SENDER:'created@thenewscc.com.br'};
  const web={...common,PHRASE_SOURCE:'firestore',WEB_HOST:'0.0.0.0'};
  const header=`#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PROJECT_ID='${projectId}'
REGION='${region}'
WORKER="agoniados-worker@$PROJECT_ID.iam.gserviceaccount.com"
WEB="agoniados-web@$PROJECT_ID.iam.gserviceaccount.com"
SCHEDULER="agoniados-scheduler@$PROJECT_ID.iam.gserviceaccount.com"
BUILDER="agoniados-build@$PROJECT_ID.iam.gserviceaccount.com"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/agoniados/daily-email:v1"
gc() { gcloud --project="$PROJECT_ID" "$@"; }
command -v gcloud >/dev/null || { echo 'Instale e autentique o gcloud primeiro.' >&2; exit 1; }
`;
  return {
    'worker-env.yaml':JSON.stringify(worker,null,2)+'\n',
    'web-env.yaml':JSON.stringify(web,null,2)+'\n',
    'provision.sh':header+`
# First-time provisioning only. These commands create billable-capable resources.
[[ -s data/token.json ]] || { echo 'Execute npm run email:auth antes de provisionar.' >&2; exit 1; }
gc projects describe "$PROJECT_ID" >/dev/null
[[ "$(gc billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')" == 'True' ]] || { echo 'Vincule o faturamento ao projeto primeiro.' >&2; exit 1; }
gc services enable run.googleapis.com cloudscheduler.googleapis.com firestore.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com gmail.googleapis.com
# If any resource already exists, the command stops. Inspect it instead of recreating/deleting data.
gc firestore databases create --database='(default)' --location="$REGION" --type=firestore-native
for account in agoniados-worker agoniados-web agoniados-scheduler agoniados-build; do gc iam service-accounts create "$account"; done
gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$WORKER" --role=roles/datastore.user
gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$WEB" --role=roles/datastore.viewer
gc secrets create agoniados-gmail-token --replication-policy=automatic --data-file=data/token.json
gc secrets add-iam-policy-binding agoniados-gmail-token --member="serviceAccount:$WORKER" --role=roles/secretmanager.secretAccessor
gc secrets create agoniados-web-password --replication-policy=automatic --data-file=data/deploy/web-password.txt
gc secrets add-iam-policy-binding agoniados-web-password --member="serviceAccount:$WEB" --role=roles/secretmanager.secretAccessor
gc artifacts repositories create agoniados --repository-format=docker --location="$REGION"
gc artifacts repositories add-iam-policy-binding agoniados --location="$REGION" --member="serviceAccount:$BUILDER" --role=roles/artifactregistry.writer
gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$BUILDER" --role=roles/logging.logWriter
gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$BUILDER" --role=roles/storage.objectViewer
`,
    'publish.sh':header+`
# Run after provisioning. Job stays disabled; no Scheduler is created here.
gc builds submit --service-account="projects/$PROJECT_ID/serviceAccounts/$BUILDER" --config=deploy/google-cloud/cloudbuild.yaml --substitutions="_IMAGE=$IMAGE" .
gc run jobs deploy agoniados-email --image="$IMAGE" --region="$REGION" --service-account="$WORKER" --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=240s --cpu=1 --memory=512Mi --env-vars-file=data/deploy/worker-env.yaml --set-secrets=/secrets/gmail/token.json=agoniados-gmail-token:1
gc run deploy agoniados-web --image="$IMAGE" --region="$REGION" --service-account="$WEB" --command=node --args=--import,tsx,src/web/server.ts --port=8080 --min-instances=0 --max-instances=1 --memory=512Mi --cpu=1 --concurrency=20 --timeout=60s --env-vars-file=data/deploy/web-env.yaml --set-secrets=WEB_PASSWORD=agoniados-web-password:1 --allow-unauthenticated
gc run jobs add-iam-policy-binding agoniados-email --region="$REGION" --member="serviceAccount:$SCHEDULER" --role=roles/run.invoker
`,
    'activate.sh':header+`
[[ $# -eq 1 ]] || { echo "Use --confirm-local-stopped após parar o envio local." >&2; exit 1; }
[[ "$1" == '--confirm-local-stopped' ]] || { echo 'Pare os agendadores locais/VPS e ative somente em um dia ainda não enviado. Depois use --confirm-local-stopped.' >&2; exit 1; }
gc run jobs update agoniados-email --region="$REGION" --update-env-vars=CLOUD_EMAIL_ENABLED=true
gc scheduler jobs create http agoniados-email --location="$REGION" --schedule='10,15,20,25,30 6 * * *' --time-zone=America/Sao_Paulo --uri="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/agoniados-email:run" --http-method=POST --oauth-service-account-email="$SCHEDULER" --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform --headers=Content-Type=application/json --message-body='{}' --max-retry-attempts=0
`,
  };
}

export async function writeDeployment(directory: string, files: Record<string,string>) {
  await mkdir(path.dirname(directory),{recursive:true,mode:0o700});
  // Never overwrite existing recipient settings or rotate a password silently.
  try { await mkdir(directory,{mode:0o700}); }
  catch(error) { if((error as NodeJS.ErrnoException).code==='EEXIST') throw new ConfigurationError('A pasta de deploy já existe. Revise os arquivos existentes; nenhuma configuração foi sobrescrita.'); throw error; }
  try {
    for(const [name,content] of Object.entries(files)) await writeFile(path.join(directory,name),content,{flag:'wx',mode:0o600});
    await writeFile(path.join(directory,'web-password.txt'),randomBytes(24).toString('hex'),{flag:'wx',mode:0o600});
  } catch(error) { await rm(directory,{recursive:true,force:true});throw error; }
}
