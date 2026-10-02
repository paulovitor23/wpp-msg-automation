import { authenticate } from '@google-cloud/local-auth';
import { OAuth2Client } from 'google-auth-library';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

const scope = 'https://www.googleapis.com/auth/gmail.readonly';
const credentialsPath = path.resolve('data/credentials.json');
const tokenPath = path.resolve('data/token.json');

export async function authorize(interactive = false): Promise<OAuth2Client> {
  if (!interactive) {
    let saved;
    try { saved = JSON.parse(await readFile(tokenPath, 'utf8')); }
    catch { throw new Error('Autorização ausente ou inválida. Execute npm run gmail:auth.'); }
    if (!saved.client_id || !saved.client_secret || !saved.refresh_token) {
      throw new Error('Autorização incompleta. Execute npm run gmail:auth novamente.');
    }
    const client = new OAuth2Client(saved.client_id, saved.client_secret);
    client.setCredentials({ refresh_token: saved.refresh_token });
    return client;
  }
  let credentials;
  try { credentials = JSON.parse(await readFile(credentialsPath, 'utf8')).installed; }
  catch { throw new Error('Salve as credenciais OAuth de aplicativo Desktop em data/credentials.json.'); }
  if (!credentials?.client_id || !credentials?.client_secret) {
    throw new Error('As credenciais devem ser do tipo Desktop, não Web.');
  }
  await chmod(credentialsPath, 0o600);
  const client = await authenticate({ scopes: [scope], keyfilePath: credentialsPath });
  if (!client.credentials.refresh_token) throw new Error('Google não forneceu acesso offline. Autorize novamente.');
  await mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, JSON.stringify({
    client_id: credentials.client_id, client_secret: credentials.client_secret,
    refresh_token: client.credentials.refresh_token,
  }), { mode: 0o600 });
  await chmod(tokenPath, 0o600);
  // local-auth may use its own version of google-auth-library internally.
  const savedClient = new OAuth2Client(credentials.client_id, credentials.client_secret);
  savedClient.setCredentials({ refresh_token: client.credentials.refresh_token });
  return savedClient;
}
