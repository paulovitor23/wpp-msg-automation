import { parseArgs } from 'node:util';
import { gmailConfig } from './config.js';
import { authorize } from './gmail/auth.js';
import { createMailbox, findNewsletter } from './gmail/client.js';
import { formatMessage } from './delivery/format.js';

try {
  const { values } = parseArgs({ options: {
    auth: { type: 'boolean' }, date: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) console.log('npm run gmail:auth | npm run gmail:preview -- [--date YYYY-MM-DD] [--json]');
  else if (values.auth) {
    await authorize(true);
    console.log('Gmail autorizado para leitura. Execute npm run gmail:preview.');
  } else {
    const config = gmailConfig(values.date);
    const result = await findNewsletter(createMailbox(await authorize()), config);
    console.log(values.json ? JSON.stringify(result, null, 2) : result
      ? formatMessage(result.newsletter) : `Nenhuma newsletter encontrada para ${config.editionDate}.`);
  }
} catch (error) {
  // Do not print Google request objects: they can include authorization headers.
  const code = (error as { code?: unknown })?.code;
  const message = code === 401 || code === 'invalid_grant'
    ? 'Autorização expirada ou revogada. Execute npm run gmail:auth novamente.'
    : error instanceof Error ? error.message : 'Falha desconhecida.';
  console.error(`Prévia interrompida: ${message}`);
  process.exitCode = 1;
}
