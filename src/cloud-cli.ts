import { cloudConfig, statusDate } from './cloud/config.js';
import { cloudStatus } from './cloud/status.js';
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
import { describeFailure, ConfigurationError } from './failures.js';

let db: Firestore | undefined;
try {
  const { values } = parseArgs({ options: { preview: { type: 'boolean' }, status: { type: 'boolean' }, date: { type: 'string' } } });
  if (values.preview && values.status || values.date && !values.status) throw new ConfigurationError('Use --date somente com --status; --preview e --status são exclusivos.');
  if (values.status) {
    const config = cloudConfig();
    const date = statusDate(values.date, config.zone);
    db = new Firestore({ projectId: config.projectId });
    console.log(JSON.stringify(await cloudStatus(db, config.namespace, date), null, 2));
  } else {
    const config = gmailConfig();
    const now = DateTime.now().setZone(config.zone);
    const cloud = values.preview ? null : cloudConfig(process.env, true);
    const recipients = emailRecipients();
    if (values.preview) {
      const auth = await authorize();
      await prepareEmailSender(auth);
      const result = await findNewsletter(createMailbox(auth), config);
      console.log(JSON.stringify({ status: result ? 'preview_ready' : 'not_found', editionDate: config.editionDate, recipients: recipients.length }));
    } else {
      if (!cloudSlot(now)) {
        console.log(JSON.stringify({ status: 'outside_window' }));
      } else {
        db = new Firestore({ projectId: cloud!.projectId });
        const stores = firestoreStores(db, cloud!.namespace);
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
  }
} catch (error) {
  console.error(JSON.stringify({ severity: 'ERROR', status: describeFailure(error).code, detail: describeFailure(error).message }));
  process.exitCode = 1;
} finally {
  try { await db?.terminate(); } catch { console.error(JSON.stringify({severity:'ERROR',status:'storage_shutdown_error'})); process.exitCode = 1; }
}
