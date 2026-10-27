import { DateTime } from 'luxon';
import { ConfigurationError } from '../failures.js';

export function cloudConfig(env = process.env, requireSending = false) {
  if (requireSending && env.CLOUD_EMAIL_ENABLED !== 'true') throw new ConfigurationError('Envio desabilitado. Configure CLOUD_EMAIL_ENABLED=true somente após validar o deploy.');
  const projectId = env.GOOGLE_CLOUD_PROJECT;
  if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new ConfigurationError('Configure GOOGLE_CLOUD_PROJECT com o ID válido do projeto Google.');
  const namespace = env.CLOUD_JOB_KEY ?? 'daily-email';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace)) throw new ConfigurationError('CLOUD_JOB_KEY deve ter de 1 a 80 letras, números, hífens ou sublinhados.');
  const zone = env.TIMEZONE ?? 'America/Sao_Paulo';
  if (!DateTime.now().setZone(zone).isValid) throw new ConfigurationError('Configure TIMEZONE com um fuso válido.');
  return { projectId, namespace, zone };
}
export function statusDate(value: string | undefined, zone: string) {
  const date = value ?? DateTime.now().setZone(zone).toISODate()!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date, {zone}).isValid) throw new ConfigurationError('Use --date no formato YYYY-MM-DD com uma data válida.');
  return date;
}
