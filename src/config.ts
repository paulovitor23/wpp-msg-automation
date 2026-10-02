import 'dotenv/config';
import { DateTime } from 'luxon';

export function dayWindow(date: string, zone: string) {
  const start = DateTime.fromISO(date, { zone }).startOf('day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !start.isValid || start.toISODate() !== date) {
    throw new Error('Data ou fuso inválido. Use YYYY-MM-DD e um fuso como America/Sao_Paulo.');
  }
  return { start: start.toMillis(), end: start.plus({ days: 1 }).toMillis() };
}

export function gmailConfig(date?: string) {
  const sender = process.env.NEWSLETTER_SENDER ?? 'created@thenewscc.com.br';
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(sender)) {
    throw new Error('NEWSLETTER_SENDER deve conter um único endereço de e-mail.');
  }
  const zone = process.env.TIMEZONE ?? 'America/Sao_Paulo';
  const editionDate = date ?? DateTime.now().setZone(zone).toISODate();
  if (!editionDate) throw new Error('TIMEZONE inválido.');
  return { sender, zone, editionDate, ...dayWindow(editionDate, zone) };
}
