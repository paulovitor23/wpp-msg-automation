import { gmail } from '@googleapis/gmail';
import type { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DateTime } from 'luxon';
import type { Newsletter } from '../newsletter/types.js';
import { validate } from '../newsletter/validate.js';
import { formatMessage } from './format.js';

const addressPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export function emailRecipients(value = process.env.EMAIL_RECIPIENTS ?? ''): string[] {
  const addresses = value.split(',').map(value => value.trim().toLowerCase());
  if (addresses.some(address => !addressPattern.test(address))) throw new Error('Configure EMAIL_RECIPIENTS com endereços válidos separados por vírgulas.');
  const unique = [...new Set(addresses)];
  if (unique.length > 3) throw new Error('Este projeto permite no máximo três destinatários.');
  return unique;
}

export function composeEmail(from: string, to: string, newsletter: Newsletter): string {
  if (!addressPattern.test(from) || !addressPattern.test(to)) throw new Error('Endereço de e-mail inválido.');
  const subject = `Frase dos Agoniados | ${newsletter.editionDate.split('-').reverse().join('/')}`;
  const body = Buffer.from(formatMessage(newsletter)).toString('base64').match(/.{1,76}/g)!.join('\r\n');
  return Buffer.from([
    `From: ${from}`, `To: ${to}`, `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${randomUUID()}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64', '', body, '',
  ].join('\r\n')).toString('base64url');
}

export async function sendIndividualEmails(db: DatabaseSync, from: string, recipients: string[],
  gmailId: string, newsletter: Newsletter, send: (raw: string) => Promise<string>,
  expectedDate = DateTime.now().setZone(process.env.TIMEZONE ?? 'America/Sao_Paulo').toISODate()!) {
  validate(newsletter, expectedDate);
  const emails = emailRecipients(recipients.join(','));
  // Prepare all content before claiming any delivery, so invalid input cannot cause partial sends.
  const messages = emails.map(to => ({ to, raw: composeEmail(from, to, newsletter) }));
  db.exec(`CREATE TABLE IF NOT EXISTS email_deliveries (
    sender TEXT NOT NULL, recipient TEXT NOT NULL, edition_date TEXT NOT NULL,
    gmail_id TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(sender,recipient,edition_date), UNIQUE(sender,recipient,gmail_id)
  )`);
  const results: { recipient: string; status: string }[] = [];
  for (const { to, raw } of messages) {
    const claimed = db.prepare(`INSERT OR IGNORE INTO email_deliveries(sender,recipient,edition_date,gmail_id,status)
      VALUES (?,?,?,?,'sending')`).run(from, to, newsletter.editionDate, gmailId);
    if (!claimed.changes) {
      const row = db.prepare('SELECT status FROM email_deliveries WHERE sender=? AND recipient=? AND (edition_date=? OR gmail_id=?)')
        .get(from, to, newsletter.editionDate, gmailId);
      results.push({ recipient: to, status: `skipped:${row?.status}` });
      continue;
    }
    try {
      const id = await send(raw);
      if (!id) throw new Error('Gmail não confirmou o envio.');
      db.prepare("UPDATE email_deliveries SET status='sent',message_id=?,updated_at=CURRENT_TIMESTAMP WHERE sender=? AND recipient=? AND edition_date=?")
        .run(id, from, to, newsletter.editionDate);
      results.push({ recipient: to, status: 'sent' });
    } catch {
      db.prepare("UPDATE email_deliveries SET status='uncertain',updated_at=CURRENT_TIMESTAMP WHERE sender=? AND recipient=? AND edition_date=?")
        .run(from, to, newsletter.editionDate);
      results.push({ recipient: to, status: 'uncertain' });
      // Stop this batch on failure. A later run skips attempted recipients and handles only untouched ones.
      break;
    }
  }
  return results;
}


export async function prepareEmailSender(auth: OAuth2Client) {
  const access = await auth.getAccessToken();
  if (!access.token) throw new Error('Execute npm run email:auth para autorizar o envio.');
  const info = await auth.getTokenInfo(access.token);
  if (!info.scopes.includes('https://www.googleapis.com/auth/gmail.send')) {
    throw new Error('Falta permissão de envio. Execute npm run email:auth.');
  }
  const api = gmail({ version: 'v1', auth });
  const profile = await api.users.getProfile({ userId: 'me' }, { timeout: 30000 });
  const from = profile.data.emailAddress;
  if (!from) throw new Error('Não foi possível identificar o remetente.');
  return { from, send: async (raw: string) => {
    const response = await api.users.messages.send({ userId: 'me', requestBody: { raw } }, { timeout: 30000, retry: false });
    return response.data.id ?? '';
  } };
}
