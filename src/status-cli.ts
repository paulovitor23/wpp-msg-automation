import 'dotenv/config';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { gmailConfig } from './config.js';

if (!existsSync('data/history.sqlite')) {
  console.log('Nenhuma execução registrada ainda.');
} else {
  const db = new DatabaseSync('data/history.sqlite', { readOnly: true });
  try {
    const { editionDate } = gmailConfig();
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    console.log(`Estado de ${editionDate}:`);
    const attempts = tables.has('attempts') ? db.prepare('SELECT slot,status,detail FROM attempts WHERE slot LIKE ? ORDER BY slot').all(`email:${editionDate}T%`) : [];
    if (!attempts.length) console.log('Sem tentativa agendada registrada hoje.');
    for (const row of attempts) console.log(`${row.slot}: ${row.status}${row.detail ? ` — ${row.detail}` : ''}`);
    if (tables.has('email_deliveries')) {
      for (const row of db.prepare('SELECT recipient,status FROM email_deliveries WHERE edition_date=?').all(editionDate)) {
        console.log(`${row.recipient}: ${row.status}`);
      }
    }
    console.log('sending/uncertain: confira Enviados antes de qualquer recuperação; não apague o histórico.');
  } finally { db.close(); }
}
