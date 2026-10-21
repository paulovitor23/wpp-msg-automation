# Envio sob demanda no Google Cloud

Cloud Scheduler chama um Cloud Run Job às **06:10, 06:15, 06:20, 06:25 e 06:30**, em `America/Sao_Paulo`. Cada execução tenta uma vez e encerra; não fica aguardando em um loop. Atraso de inicialização é aceito dentro da janela (até 06:30:59), atribuindo a execução ao intervalo de cinco minutos atual. Não há recuperação automática fora da janela.

O job reutiliza a extração, validação, composição e envio do projeto. Firestore substitui o SQLite **somente nesse comando**. O front-end e os comandos locais continuam locais.

## Estado e falhas

Em `automations/{CLOUD_JOB_KEY}`:

- `days/{YYYY-MM-DD}`: estado diário, frase validada e ID da newsletter.
- `days/{YYYY-MM-DD}/attempts/{slot}`: resultado de cada tentativa.
- `deliveries/{hash}`: remetente, destinatário, edição, estado e ID retornado pelo Gmail.
- `sources/{hash}`: reserva adicional por mensagem de origem e destinatário.

As reservas são transações Firestore. Apenas uma execução pode processar o dia por vez, e apenas uma pode reservar cada envio. As chamadas ao Gmail ficam **fora das transações**, pois transações podem ser reexecutadas pelo SDK.

`not_found` e `temporary_error` permitem o próximo horário. Sucesso, erro de autorização/formato, falha inesperada ou envio incompleto bloqueiam o restante do dia. Uma queda deixa `checking` ou `sending`, também bloqueados. Não há expiração automática dessas reservas: privilegia-se evitar duplicação em vez de garantir entrega.

Se o Gmail aceitar a mensagem mas a gravação do resultado falhar, o resultado permanece incerto. Confira Enviados e os documentos antes de qualquer correção. **Não apague reservas nem mude CLOUD_JOB_KEY para forçar reenvio.** Nesta versão, recuperação de envios incertos exige conferência e intervenção manual; não existe comando automático de recuperação na nuvem.

O Cloud Logging recebe resultados estruturados sem tokens ou corpo da mensagem. Configure um alerta para `severity>=WARNING` no job se quiser notificações; nenhum canal de alerta é criado por este repositório. `npm run email:status` consulta apenas o SQLite local; para nuvem consulte Firestore e os logs.

## Antes de publicar

- Projeto Google com faturamento, Gmail API e OAuth de leitura/envio já configurados. Cotas gratuitas não garantem fatura zero: confira Cloud Run, Scheduler, Firestore, Secret Manager, Artifact Registry e Cloud Build. Configure orçamento/alertas; orçamento não bloqueia cobranças.
- Revise OAuth antes de operação contínua: o refresh token de app externo em teste pode expirar em sete dias. Reautorize localmente com `npm run email:auth` quando necessário e atualize a versão do secret.
- Instale/autentique o `gcloud` no computador ou use Cloud Shell. Os exemplos abaixo são comandos **manuais**, não executados ao iniciar o projeto.
- Utilize um projeto dedicado quando possível. O papel `datastore.user` dá acesso ao banco do projeto, não apenas a uma coleção. Nenhuma chave JSON de service account é necessária.

## 1. Projeto, banco e contas de serviço

Execute na raiz do repositório, substituindo o projeto:

```sh
export PROJECT_ID='seu-projeto'
export REGION='us-central1'
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com firestore.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com gmail.googleapis.com

gcloud firestore databases describe --database='(default)'
```

Se ainda não existir banco padrão, crie **uma vez** (a localização é uma decisão permanente):

```sh
gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native
```

Crie as identidades separadas:

```sh
gcloud iam service-accounts create agoniados-worker
gcloud iam service-accounts create agoniados-scheduler
export WORKER="agoniados-worker@$PROJECT_ID.iam.gserviceaccount.com"
export SCHEDULER="agoniados-scheduler@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$WORKER" --role=roles/datastore.user
```

## 2. Autorização do Gmail

O arquivo `data/token.json` é gerado por `npm run email:auth`. Ele contém client ID, client secret e refresh token. Envie-o diretamente ao Secret Manager, sem imprimir nem colocar na imagem/Git:

```sh
gcloud secrets create agoniados-gmail-token --replication-policy=automatic --data-file=data/token.json
gcloud secrets add-iam-policy-binding agoniados-gmail-token --member="serviceAccount:$WORKER" --role=roles/secretmanager.secretAccessor
```

Para renovar futuramente:

```sh
gcloud secrets versions add agoniados-gmail-token --data-file=data/token.json
```

Depois atualize o job para o número da nova versão. O exemplo usa a versão `1`, fixada para tornar a publicação previsível.

## 3. Imagem e job desabilitado para envio

```sh
gcloud artifacts repositories create agoniados --repository-format=docker --location="$REGION"
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/agoniados/daily-email:v1"
gcloud builds submit --config=deploy/google-cloud/cloudbuild.yaml --substitutions="_IMAGE=$IMAGE" .
```

A conta de execução do Cloud Build precisa poder gravar nesse repositório (`roles/artifactregistry.writer`); confira a identidade e permissões do seu projeto se o build for negado. `.gcloudignore` e `.dockerignore` usam uma lista explícita de arquivos permitidos: não enviam `.env`, `data/`, credenciais ou histórico.

Copie `deploy/google-cloud/env.example.yaml` para `deploy/google-cloud/env.yaml` (ignorado pelo Git), preencha projeto e os três destinatários. Mantenha `CLOUD_EMAIL_ENABLED: "false"` inicialmente.

```sh
gcloud run jobs create agoniados-email --image="$IMAGE" --region="$REGION" --service-account="$WORKER" --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=240s --cpu=1 --memory=512Mi --env-vars-file=deploy/google-cloud/env.yaml --set-secrets=/secrets/gmail/token.json=agoniados-gmail-token:1
```

Primeiro execute uma prévia, sem enviar nem modificar o Firestore:

```sh
gcloud run jobs execute agoniados-email --region="$REGION" --args=--import,tsx,src/cloud-cli.ts,--preview --wait
```

A prévia verifica autorização de envio e leitura da newsletter; informa apenas disponibilidade, data e quantidade de destinatários. **Não valida acesso ao Firestore.** As transações devem ser verificadas em ambiente de teste antes de ativar destinatários reais. Os testes locais usam serviços simulados.

## 4. Ativação e agendamento

**Antes de habilitar:** pare o agendador local e o timer VPS. O banco local e o Firestore são independentes e não detectam envios um do outro. Faça a transição antes da primeira tentativa de um novo dia, sem envio local nesse dia. Use sempre o mesmo `CLOUD_JOB_KEY` para esta automação.

Depois de conferir configurações, altere `CLOUD_EMAIL_ENABLED` para `"true"` no YAML e aplique:

```sh
gcloud run jobs update agoniados-email --region="$REGION" --env-vars-file=deploy/google-cloud/env.yaml
gcloud run jobs add-iam-policy-binding agoniados-email --region="$REGION" --member="serviceAccount:$SCHEDULER" --role=roles/run.invoker

gcloud scheduler jobs create http agoniados-email --location="$REGION" --schedule='10,15,20,25,30 6 * * *' --time-zone='America/Sao_Paulo' --uri="https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/agoniados-email:run" --http-method=POST --oauth-service-account-email="$SCHEDULER" --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform --headers=Content-Type=application/json --message-body='{}' --max-retry-attempts=0
```

O endpoint de API Google usa OAuth, não OIDC. Sucesso do Scheduler confirma o disparo, não a entrega de e-mail: confira a execução do Cloud Run, seus logs e o Firestore.

Para pausar futuros disparos:

```sh
gcloud scheduler jobs pause agoniados-email --location="$REGION"
```

Pausar não cancela execução já iniciada. O job não publica a página nem cria endpoint público.

## Verificação local

```sh
npm test
npm run typecheck
# Requer Docker em execução; não acessa contas:
docker build -f deploy/google-cloud/Dockerfile -t agoniados-email .
```

`npm run cloud:preview` acessa o Gmail autorizado, mas não envia. `npm run cloud:run` exige habilitação explícita, projeto e credenciais de aplicação Google para o Firestore; dentro da janela, **envia e-mails reais**.

Referências: [agendamento de jobs](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule), [secrets](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets), [transações Firestore](https://googleapis.dev/nodejs/firestore/latest/Transaction.html).
