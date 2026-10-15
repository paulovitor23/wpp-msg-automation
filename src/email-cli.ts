import 'dotenv/config';
import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { authorize } from './gmail/auth.js';
import { gmailConfig } from './config.js';
import { createMailbox, findNewsletter } from './gmail/client.js';
import { openHistory } from './scheduler.js';
import { emailRecipients, sendIndividualEmails, prepareEmailSender } from './delivery/email.js';
import { formatMessage } from './delivery/format.js';

try {
  const { values } = parseArgs({ options: { preview: { type: 'boolean' }, auth: { type: 'boolean' } } });
  if (values.auth) {
    await authorize(true, true);
    console.log('Gmail autorizado. Use npm run email:preview para conferir ou npm run email:send para enviar.');
  } else {
    const recipients = emailRecipients();
    const auth = await authorize();
    const sender = values.preview ? null : await prepareEmailSender(auth);
    const result = await findNewsletter(createMailbox(auth), gmailConfig());
    if (!result) throw new Error('Nenhuma newsletter encontrada para hoje.');
    if (values.preview) {
      console.log(`Três ou menos mensagens individuais para: ${recipients.join(', ')}\n\n${formatMessage(result.newsletter)}`);
    } else {
      await mkdir('data', { recursive: true, mode: 0o700 });
      const db = openHistory('data/history.sqlite');
      try {
        const results = await sendIndividualEmails(db, sender!.from, recipients, result.gmailId, result.newsletter, sender!.send);
        for (const item of results) {
          console.log(`${item.recipient}: ${item.status === 'sent' ? 'envio aceito pelo Gmail' : item.status === 'skipped:sent' ? 'já enviado; ignorado' : 'tentativa pendente/incerta; confira Enviados antes de repetir'}`);
        }
        if (results.some(item => item.status !== 'sent' && item.status !== 'skipped:sent')) process.exitCode = 1;
      } finally { db.close(); }
    }
  }
} catch (error) {
  // Never dump Google request objects, which may contain credentials or message bodies.
  console.error(`E-mail interrompido: ${error instanceof Error ? error.message : 'falha desconhecida'}`);
  process.exitCode = 1;
}
