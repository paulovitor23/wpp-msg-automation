import 'dotenv/config';
import { parseArgs } from 'node:util';
import { DateTime } from 'luxon';
import { Firestore } from '@google-cloud/firestore';
import { authorize } from './gmail/auth.js';
import { createMailbox, findNewsletter } from './gmail/client.js';
import { gmailConfig } from './config.js';
import { emailRecipients, prepareEmailSender, sendEmails } from './delivery/email.js';
import { firestoreStores } from './storage/firestore.js';
import { cloudSlot, runDailyEmail } from './jobs/daily-email.js';
import { describeFailure } from './failures.js';

let db: Firestore | undefined;
try {
  const { values } = parseArgs({ options: { preview: { type: 'boolean' } } });
  const config = gmailConfig();
  const now = DateTime.now().setZone(config.zone);
  const recipients = emailRecipients();
  if (values.preview) {
    const auth = await authorize();
    await prepareEmailSender(auth);
    const result = await findNewsletter(createMailbox(auth), config);
    console.log(JSON.stringify({ status: result ? 'preview_ready' : 'not_found', editionDate: config.editionDate, recipients: recipients.length }));
  } else {
    if (process.env.CLOUD_EMAIL_ENABLED !== 'true') throw new Error('CLOUD_EMAIL_ENABLED deve ser true para enviar.');
    if (!process.env.GOOGLE_CLOUD_PROJECT) throw new Error('Configure GOOGLE_CLOUD_PROJECT.');
    if (!cloudSlot(now)) {
      console.log(JSON.stringify({ status: 'outside_window' }));
    } else {
      db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
      const stores = firestoreStores(db, process.env.CLOUD_JOB_KEY ?? 'daily-email');
      let sender: Awaited<ReturnType<typeof prepareEmailSender>>;
      const result = await runDailyEmail({ now, history: stores.history,
        find: async () => {
          const auth = await authorize();
          sender = await prepareEmailSender(auth);
          return findNewsletter(createMailbox(auth), config);
        },
        deliver: result => sendEmails(stores.emails, sender.from, recipients, result.gmailId, result.newsletter, sender.send, config.editionDate),
      });
      console.log(JSON.stringify({ severity: ['emails_sent','skipped','outside_window'].includes(result.status) ? 'INFO' : 'WARNING', ...result }));
      if (!['emails_sent','skipped','outside_window','not_found'].includes(result.status)) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error(JSON.stringify({ severity: 'ERROR', status: 'job_error', detail: describeFailure(error).message }));
  process.exitCode = 1;
} finally {
  await db?.terminate();
}
