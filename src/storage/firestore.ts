import { createHash } from 'node:crypto';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import type { EmailStore } from './email-store.js';
import type { CloudHistory } from '../jobs/daily-email.js';
import { validate } from '../newsletter/validate.js';

const key = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export function firestoreStores(db: Firestore, namespace: string): { history: CloudHistory; emails: EmailStore } {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace)) throw new Error('CLOUD_JOB_KEY inválido.');
  const root = db.collection('automations').doc(namespace);
  const days = root.collection('days');
  const deliveries = root.collection('deliveries');
  return {
    history: {
      async claimRun(date, slot) {
        const day = days.doc(date);
        const attempt = day.collection('attempts').doc(slot);
        return db.runTransaction(async tx => {
          const [previous, existing] = await tx.getAll(day, attempt);
          if (existing.exists || previous.exists && !['not_found','temporary_error'].includes(previous.get('status'))) return false;
          const data = { status: 'checking', slot, updatedAt: FieldValue.serverTimestamp() };
          tx.set(day, data, { merge: true });
          tx.create(attempt, data);
          return true;
        });
      },
      async finishRun(date, slot, status, detail) {
        const day = days.doc(date);
        const batch = db.batch();
        const data = { status, detail, updatedAt: FieldValue.serverTimestamp() };
        batch.update(day, data);
        batch.update(day.collection('attempts').doc(slot), data);
        await batch.commit();
      },
      async savePhrase(date, gmailId, newsletter) {
        validate(newsletter, date);
        await days.doc(date).update({ gmailId, newsletter });
      },
    },
    emails: {
      async claim(from, to, date, gmailId) {
        const delivery = deliveries.doc(key(from, to, date));
        const source = root.collection('sources').doc(key(from, to, gmailId));
        return db.runTransaction(async tx => {
          const [existing, seenSource] = await tx.getAll(delivery, source);
          if (existing.exists) return String(existing.get('status'));
          if (seenSource.exists) return 'source_already_claimed';
          tx.create(delivery, { sender: from, recipient: to, editionDate: date, gmailId, status: 'sending', updatedAt: FieldValue.serverTimestamp() });
          tx.create(source, { delivery: delivery.id });
          return null;
        });
      },
      async finish(from, to, date, status, messageId) {
        await deliveries.doc(key(from,to,date)).update({ status, messageId: messageId ?? null, updatedAt: FieldValue.serverTimestamp() });
      },
    },
  };
}
