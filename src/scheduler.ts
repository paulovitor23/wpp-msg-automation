import { DateTime } from 'luxon';
import { DatabaseSync } from 'node:sqlite';
import { gmailConfig } from './config.js';
import { findNewsletter, type Mailbox } from './gmail/client.js';
import { formatMessage } from './delivery/format.js';

export function scheduledSlot(now: DateTime): string | null {
  if (!now.isValid) throw new Error('Fuso ou horário inválido.');
  return now.hour === 6 && now.minute === 10
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
  log: (text: string) => void = console.log): Promise<void> {
  const slot = scheduledSlot(now);
  if (!slot) return;
  const date = now.toISODate()!;
  if (db.prepare('SELECT 1 FROM processed WHERE edition_date = ?').get(date)) return;
  // Claim each slot durably, including across restarts or two running copies.
  if (!db.prepare("INSERT OR IGNORE INTO attempts(slot,status) VALUES (?, 'checking')").run(slot).changes) return;
  let result;
  try {
    result = await findNewsletter(mailbox, gmailConfig(date));
  } catch (error) {
    const e = error as { code?: unknown; message?: string; response?: { data?: { error?: string } } };
    const auth = e.code === 401 || e.response?.data?.error === 'invalid_grant' || e.message === 'invalid_grant';
    const detail = auth ? 'Autorização expirada/revogada: execute npm run gmail:auth.'
      : e.message?.includes('validação') || e.message?.includes('Mais de uma newsletter')
        ? 'Formato/data inválido ou edições ambíguas; confira com gmail:preview.'
        : 'Falha ao consultar Gmail; confira conexão e execute gmail:preview.';
    db.prepare('UPDATE attempts SET status=?,detail=?,updated_at=CURRENT_TIMESTAMP WHERE slot=?')
      .run(auth ? 'auth_error' : 'error', detail, slot);
    log(`[${slot}] ${detail}`);
    return;
  }
  if (!result) {
    db.prepare("UPDATE attempts SET status='not_found',updated_at=CURRENT_TIMESTAMP WHERE slot=?").run(slot);
    log(`[${slot}] E-mail ainda não chegou.${now.minute === 30 ? ' Última tentativa do dia.' : ''}`);
    return;
  }
  // Persist before displaying; a crash cannot cause the preview to be processed twice.
  const saved = db.prepare('INSERT OR IGNORE INTO processed(edition_date,gmail_id,newsletter) VALUES (?,?,?)')
    .run(date, result.gmailId, JSON.stringify(result.newsletter));
  db.prepare("UPDATE attempts SET status='processed',updated_at=CURRENT_TIMESTAMP WHERE slot=?").run(slot);
  if (saved.changes) log(`[${slot}] Processada (não enviada):\n${formatMessage(result.newsletter)}`);
}
