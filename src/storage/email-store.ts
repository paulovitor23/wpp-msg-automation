import type { DatabaseSync } from 'node:sqlite';

export interface EmailStore {
  // null means exclusively reserved; any existing status must never be sent again.
  claim(from: string, to: string, date: string, gmailId: string): Promise<string | null>;
  finish(from: string, to: string, date: string, status: 'sent' | 'uncertain', messageId?: string): Promise<void>;
}

export function sqliteEmailStore(db: DatabaseSync): EmailStore {
  db.exec(`CREATE TABLE IF NOT EXISTS email_deliveries (
    sender TEXT NOT NULL, recipient TEXT NOT NULL, edition_date TEXT NOT NULL,
    gmail_id TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(sender,recipient,edition_date), UNIQUE(sender,recipient,gmail_id)
  )`);
  return {
    async claim(from, to, date, gmailId) {
      const claimed = db.prepare(`INSERT OR IGNORE INTO email_deliveries(sender,recipient,edition_date,gmail_id,status)
        VALUES (?,?,?,?,'sending')`).run(from, to, date, gmailId);
      if (claimed.changes) return null;
      const row = db.prepare('SELECT status FROM email_deliveries WHERE sender=? AND recipient=? AND (edition_date=? OR gmail_id=?)').get(from,to,date,gmailId);
      return String(row?.status ?? 'unknown');
    },
    async finish(from, to, date, status, messageId) {
      db.prepare('UPDATE email_deliveries SET status=?,message_id=?,updated_at=CURRENT_TIMESTAMP WHERE sender=? AND recipient=? AND edition_date=?')
        .run(status, messageId ?? null, from, to, date);
    },
  };
}
