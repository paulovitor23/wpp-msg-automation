import type { Firestore } from '@google-cloud/firestore';

export async function cloudStatus(db: Firestore, namespace: string, date: string) {
  const root = db.collection('automations').doc(namespace);
  const day = root.collection('days').doc(date);
  const [state, attempts, deliveries] = await Promise.all([
    day.get(), day.collection('attempts').orderBy('slot').get(),
    root.collection('deliveries').where('editionDate', '==', date).get(),
  ]);
  // Explicit fields keep newsletter bodies, tokens and unrelated document data out of diagnostics.
  return {
    date, status: state.exists ? state.get('status') : 'not_started',
    attempts: attempts.docs.map(doc => ({ slot: doc.get('slot'), status: doc.get('status'), detail: doc.get('detail') ?? null })),
    deliveries: deliveries.docs.map(doc => ({ recipient: doc.get('recipient'), status: doc.get('status'), messageId: doc.get('messageId') ?? null })),
  };
}
