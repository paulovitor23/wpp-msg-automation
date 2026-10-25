import { DateTime } from 'luxon';
import type { DatabaseSync } from 'node:sqlite';
import { FieldPath, type Firestore } from '@google-cloud/firestore';
import type { Newsletter } from '../newsletter/types.js';
import { validate } from '../newsletter/validate.js';

export type PhraseView = Newsletter & { notice?: string };
export function publicPhrase(value: unknown, today: string): Newsletter {
  const data = value as Partial<Newsletter> | null;
  if (!data || typeof data.title !== 'string' || typeof data.message !== 'string' || typeof data.editionDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.editionDate) || !DateTime.fromISO(data.editionDate).isValid || data.editionDate > today) {
    throw new Error('Frase salva inválida.');
  }
  return validate({ title: data.title, message: data.message, editionDate: data.editionDate });
}
function view(phrase: Newsletter, today: string, unavailable = false): PhraseView {
  const notice = phrase.editionDate < today ? 'A edição de hoje ainda não está disponível. Esta é a última frase salva.'
    : unavailable ? 'Não foi possível atualizar agora. Você está lendo a frase salva de hoje.' : undefined;
  return notice ? { ...phrase, notice } : phrase;
}
export function localPhraseReader(db: DatabaseSync,
  find: () => Promise<{ gmailId: string; newsletter: Newsletter } | null>, today: () => string) {
  return async (): Promise<PhraseView | null> => {
    const date = today();
    const row = db.prepare('SELECT newsletter FROM processed WHERE edition_date <= ? ORDER BY edition_date DESC LIMIT 1').get(date);
    const saved = row ? publicPhrase(JSON.parse(String(row.newsletter)), date) : null;
    if (saved?.editionDate === date) return saved;
    try {
      const result = await find();
      if (result) {
        const phrase = publicPhrase(result.newsletter, date);
        validate(phrase, date);
        db.prepare('INSERT OR IGNORE INTO processed(edition_date,gmail_id,newsletter) VALUES (?,?,?)')
          .run(date, result.gmailId, JSON.stringify(phrase));
        return phrase;
      }
    } catch (error) {
      if (!saved) throw error;
      return view(saved, date, true);
    }
    return saved ? view(saved, date) : null;
  };
}
export function firestorePhraseReader(db: Firestore, namespace: string, today: () => string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace)) throw new Error('CLOUD_JOB_KEY inválido.');
  return async (): Promise<PhraseView | null> => {
    const date = today();
    const days = await db.collection('automations').doc(namespace).collection('days')
      .where(FieldPath.documentId(), '<=', date).orderBy(FieldPath.documentId(), 'desc').limit(30).get();
    for (const day of days.docs) {
      const phrase = day.get('newsletter');
      if (phrase) return view(publicPhrase(phrase, date), date);
    }
    return null;
  };
}
