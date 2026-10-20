import { mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { DateTime } from 'luxon';
import { emailRecipients, prepareEmailSender, sendIndividualEmails } from './delivery/email.js';
import { gmailConfig } from './config.js';
import { authorize } from './gmail/auth.js';
import { createMailbox } from './gmail/client.js';
import { checkScheduled, openHistory } from './scheduler.js';

try {
  const { zone } = gmailConfig();
  const recipients = emailRecipients();
  const auth = await authorize();
  const sender = await prepareEmailSender(auth);
  const mailbox = createMailbox(auth);
  await mkdir('data', { recursive: true, mode: 0o700 });
  const db = openHistory('data/history.sqlite');
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  console.log(`Agendamento ativo (${zone}): 06:10–06:30 a cada cinco minutos até sucesso, envio individual por e-mail. Ctrl+C para parar.`);
  try {
    while (!stop.signal.aborted) {
      await checkScheduled(db, mailbox, DateTime.now().setZone(zone), console.log, async result => {
        const results = await sendIndividualEmails(db, sender.from, recipients, result.gmailId, result.newsletter, sender.send);
        for (const item of results) console.log(`${item.recipient}: ${item.status}`);
        if (results.some(item => item.status !== 'sent' && item.status !== 'skipped:sent')) {
          throw new Error('Lote de e-mails incompleto.');
        }
      });
      // Local clock check only; Gmail is queried only in an unclaimed scheduled minute.
      await sleep(1000, undefined, { signal: stop.signal }).catch(error => {
        if (error.name !== 'AbortError') throw error;
      });
    }
  } finally {
    db.close();
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
} catch (error) {
  console.error(`Agendamento interrompido: ${error instanceof Error ? error.message : 'falha desconhecida'}`);
  process.exitCode = 1;
}
