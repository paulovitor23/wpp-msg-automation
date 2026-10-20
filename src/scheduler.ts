import { describeFailure } from './failures.js';
import { DateTime } from 'luxon';
import { DatabaseSync } from 'node:sqlite';
import { gmailConfig } from './config.js';
import { findNewsletter, type Mailbox } from './gmail/client.js';
import type { Newsletter } from './newsletter/types.js';
import { validate } from './newsletter/validate.js';
import { formatMessage } from './delivery/format.js';

export function scheduledSlot(now: DateTime): string | null {
  if (!now.isValid) throw new Error('Fuso ou horário inválido.');
  return now.hour === 6 && now.minute >= 10 && now.minute <= 30 && now.minute % 5 === 0
    ? now.toFormat("yyyy-MM-dd'T'HH:mm") : null;
}

export function openHistory(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS attempts (
      slot TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS processed (
      edition_date TEXT PRIMARY KEY, gmail_id TEXT UNIQUE NOT NULL,
      newsletter TEXT NOT NULL, processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
  return db;
}

export async function checkScheduled(db: DatabaseSync, mailbox: Mailbox, now: DateTime,
  log: (text: string) => void = console.log,
  deliver?: (result: { gmailId: string; newsletter: Newsletter }) => Promise<void>): Promise<void> {
  const scheduled = scheduledSlot(now);
  if (!scheduled) return;
  const slot = deliver ? `email:${scheduled}` : scheduled;
  const date = now.toISODate()!;
  // A claimed delivery (including a crash) or terminal failure blocks later automatic slots.
  const prefix = deliver ? `email:${date}T` : `${date}T`;
  const previous = db.prepare('SELECT status FROM attempts WHERE slot LIKE ?').all(`${prefix}%`);
  if (previous.some(row => !['not_found', 'temporary_error'].includes(String(row.status)))) return;
  const retryNote = now.minute < 30 ? ' Nova busca em cinco minutos, se o processo continuar ativo.' : ' Janela encerrada; nenhuma nova tentativa automática hoje.';
  const cached = db.prepare('SELECT gmail_id,newsletter FROM processed WHERE edition_date = ?').get(date);
  if (cached && !deliver) return;
  // Claim each slot durably, including across restarts or two running copies.
  if (!db.prepare("INSERT OR IGNORE INTO attempts(slot,status) VALUES (?, 'checking')").run(slot).changes) return;
  let result;
  try {
    result = cached ? { gmailId: String(cached.gmail_id), newsletter: validate(JSON.parse(String(cached.newsletter)), date) }
      : await findNewsletter(mailbox, gmailConfig(date));
  } catch (error) {
    const failure = describeFailure(error);
    const detail = failure.message + (failure.retryable ? retryNote : ' Requer intervenção; sem nova tentativa automática hoje.');
    db.prepare('UPDATE attempts SET status=?,detail=?,updated_at=CURRENT_TIMESTAMP WHERE slot=?')
      .run(failure.code, detail, slot);
    log(`[${slot}] ${detail}`);
    return;
  }
  if (!result) {
    db.prepare("UPDATE attempts SET status='not_found',detail=?,updated_at=CURRENT_TIMESTAMP WHERE slot=?").run(`E-mail ainda não chegou.${retryNote}`, slot);
    log(`[${slot}] E-mail ainda não chegou.${retryNote}`);
    return;
  }
  // Persist before displaying; a crash cannot cause the preview to be processed twice.
  const saved = db.prepare('INSERT OR IGNORE INTO processed(edition_date,gmail_id,newsletter) VALUES (?,?,?)')
    .run(date, result.gmailId, JSON.stringify(result.newsletter));
  db.prepare("UPDATE attempts SET status='processed',updated_at=CURRENT_TIMESTAMP WHERE slot=?").run(slot);
  if (saved.changes) log(`[${slot}] Processada (não enviada):\n${formatMessage(result.newsletter)}`);
  if (deliver) {
    try {
      await deliver(result);
      db.prepare("UPDATE attempts SET status='emails_sent',updated_at=CURRENT_TIMESTAMP WHERE slot=?").run(slot);
      log(`[${slot}] E-mails enviados ou já registrados como enviados.`);
    } catch {
      db.prepare("UPDATE attempts SET status='email_error',detail='Envio incompleto. Confira Enviados e email:status antes de recuperar manualmente.',updated_at=CURRENT_TIMESTAMP WHERE slot=?").run(slot);
      log(`[${slot}] Envio incompleto. Confira Enviados e o histórico antes de executar email:send. Sem repetição automática hoje.`);
    }
  }

}
