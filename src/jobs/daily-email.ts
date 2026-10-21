import { DateTime } from 'luxon';
import type { Newsletter } from '../newsletter/types.js';
import { describeFailure } from '../failures.js';

export interface CloudHistory {
  claimRun(date: string, slot: string): Promise<boolean>;
  finishRun(date: string, slot: string, status: string, detail: string): Promise<void>;
  savePhrase(date: string, gmailId: string, newsletter: Newsletter): Promise<void>;
}

export function cloudSlot(now: DateTime): string | null {
  if (!now.isValid) throw new Error('Fuso inválido.');
  // Allow container startup delay within each slot, never outside the daily window.
  if (now.hour !== 6 || now.minute < 10 || now.minute > 30) return null;
  return now.set({ minute: Math.floor(now.minute / 5) * 5 }).toFormat("yyyy-MM-dd'T'HH:mm");
}

export async function runDailyEmail(options: {
  now: DateTime;
  history: CloudHistory;
  find: () => Promise<{ gmailId: string; newsletter: Newsletter } | null>;
  deliver: (result: { gmailId: string; newsletter: Newsletter }) => Promise<{ status: string }[]>;
}) {
  const { now, history } = options;
  const slot = cloudSlot(now);
  if (!slot) return { status: 'outside_window' };
  const date = now.toISODate()!;
  if (!await history.claimRun(date, slot)) return { status: 'skipped' };
  let status: string;
  let detail: string;
  let sending = false;
  try {
    const result = await options.find();
    if (!result) {
      status = 'not_found';
      detail = now.minute < 30 ? 'Aguardando a próxima busca agendada.' : 'Edição não encontrada; janela encerrada.';
    } else {
      await history.savePhrase(date, result.gmailId, result.newsletter);
      sending = true;
      const results = await options.deliver(result);
      const complete = results.length > 0 && results.every(item => item.status === 'sent' || item.status === 'skipped:sent');
      status = complete ? 'emails_sent' : 'email_error';
      detail = complete ? 'Envios confirmados ou já registrados.' : 'Lote incompleto; confira Enviados e os registros antes de recuperar.';
    }
  } catch (error) {
    const failure = describeFailure(error);
    status = sending ? 'email_error' : failure.code;
    detail = sending ? 'Envio interrompido; resultado pode ser incerto. Sem repetição automática.' : failure.message;
  }
  // If this fails, the durable checking lock remains: never guess whether email was sent.
  await history.finishRun(date, slot, status, detail);
  return { status, detail };
}
