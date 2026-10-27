import 'dotenv/config';
import { parseArgs } from 'node:util';
import { deploymentFiles, writeDeployment } from './cloud/deploy.js';
import { ConfigurationError, describeFailure } from './failures.js';
try {
  const {values}=parseArgs({options:{project:{type:'string'},region:{type:'string',default:'us-central1'}}});
  if(!values.project) throw new ConfigurationError('Informe --project ID_DO_PROJETO; use --region para alterar us-central1.');
  const files=deploymentFiles(values.project,values.region!,process.env.EMAIL_RECIPIENTS??'');
  await writeDeployment('data/deploy',files);
  console.log('Configuração criada em data/deploy, fora do Git. Envio desabilitado. Nenhum recurso foi criado. Revise os scripts e siga deploy/google-cloud/README.md.');
} catch(error) {console.error(describeFailure(error).message);process.exitCode=1;}
