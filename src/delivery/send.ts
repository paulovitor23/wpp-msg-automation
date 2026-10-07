import type { DatabaseSync } from 'node:sqlite';
import type { Newsletter } from '../newsletter/types.js';
import { validate } from '../newsletter/validate.js';
import { DateTime } from 'luxon';
import { formatMessage } from './format.js';
import { validateMessageSize } from './safety.js';

export function checkSendAllowed(db: DatabaseSync, now = DateTime.now().setZone(process.env.TIMEZONE ?? 'America/Sao_Paulo')) {
  if (!now.isValid) throw new Error('Fuso inválido.');
  db.exec(`CREATE TABLE IF NOT EXISTS deliveries (
    group_id TEXT NOT NULL, edition_date TEXT NOT NULL, gmail_id TEXT NOT NULL,
    status TEXT NOT NULL, message_id TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(group_id, edition_date), UNIQUE(group_id, gmail_id)
  )`);
  if (db.prepare("SELECT 1 FROM deliveries WHERE status IN ('sending','uncertain') LIMIT 1").get()) {
    throw new Error('Tentativa pendente/incerta: envios pausados até conferência manual no grupo e no histórico.');
  }
  const recent = db.prepare("SELECT 1 FROM deliveries WHERE updated_at >= ? OR edition_date = ? LIMIT 1")
    .get(now.toUTC().minus({ hours: 24 }).toFormat('yyyy-MM-dd HH:mm:ss'), now.toISODate()!);
  if (recent) throw new Error('Limite atingido: uma tentativa por dia e intervalo mínimo de 24 horas, mesmo trocando o grupo.');
}

export async function sendOnce(db: DatabaseSync, group: string, gmailId: string,
  newsletter: Newsletter, send: (text: string) => Promise<string>,
  now = DateTime.now().setZone(process.env.TIMEZONE ?? 'America/Sao_Paulo')): Promise<void> {
  if (!/^\d+(?:-\d+)?@g\.us$/.test(group)) throw new Error('WHATSAPP_GROUP_ID inválido. Use whatsapp:groups.');
  if (!now.isValid) throw new Error('Fuso inválido.');
  validate(newsletter, now.toISODate()!);
  const text = formatMessage(newsletter);
  validateMessageSize(text);
  // Serialize the check and claim so simultaneous processes cannot bypass the limit.
  db.exec('BEGIN IMMEDIATE');
  try {
    checkSendAllowed(db, now);
    const claim = db.prepare(`INSERT OR IGNORE INTO deliveries(group_id,edition_date,gmail_id,status,updated_at)
      VALUES (?,?,?,'sending',?)`).run(group, newsletter.editionDate, gmailId, now.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'));
    if (!claim.changes) throw new Error('Edição já enviada; não haverá reenvio.');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = await Promise.race([
      send(text),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Tempo de envio esgotado.')), 60000); }),
    ]);
    if (!id) throw new Error('Envio sem identificador de confirmação.');
    db.prepare("UPDATE deliveries SET status='sent',message_id=?,updated_at=CURRENT_TIMESTAMP WHERE group_id=? AND edition_date=?")
      .run(id, group, newsletter.editionDate);
  } catch {
    db.prepare("UPDATE deliveries SET status='uncertain',updated_at=CURRENT_TIMESTAMP WHERE group_id=? AND edition_date=?")
      .run(group, newsletter.editionDate);
    throw new Error('Resultado do envio incerto. Confira o WhatsApp antes de qualquer nova tentativa.');
  } finally { clearTimeout(timer); }
}
