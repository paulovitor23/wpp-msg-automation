import { gmail } from '@googleapis/gmail';
import type { OAuth2Client } from 'google-auth-library';
import { simpleParser } from 'mailparser';
import { extractHtml } from '../newsletter/extract.js';
import type { Newsletter } from '../newsletter/types.js';

export interface MessageData { id: string; internalDate: number; raw: string }
export interface Mailbox {
  list(query: string, pageToken?: string): Promise<{ ids: string[]; nextPageToken?: string }>;
  get(id: string): Promise<MessageData>;
}
export function createMailbox(auth: OAuth2Client): Mailbox {
  const api = gmail({ version: 'v1', auth });
  return {
    async list(q, pageToken) {
      const { data } = await api.users.messages.list({ userId: 'me', q, pageToken, maxResults: 100 }, { timeout: 30000 });
      return { ids: (data.messages ?? []).flatMap(m => m.id ? [m.id] : []), nextPageToken: data.nextPageToken ?? undefined };
    },
    async get(id) {
      const { data } = await api.users.messages.get({ userId: 'me', id, format: 'raw' }, { timeout: 30000 });
      if (!data.raw || !data.internalDate) throw new Error('Gmail retornou uma mensagem incompleta.');
      return { id, raw: data.raw, internalDate: Number(data.internalDate) };
    },
  };
}

export async function findNewsletter(mailbox: Mailbox, config: {
  sender: string; start: number; end: number; editionDate: string;
}): Promise<{ gmailId: string; newsletter: Newsletter } | null> {
  // Epoch bounds avoid Gmail's timezone interpretation of calendar search dates.
  const query = `from:${config.sender} after:${Math.floor(config.start / 1000) - 1} before:${Math.ceil(config.end / 1000)}`;
  const valid: { gmailId: string; newsletter: Newsletter }[] = [];
  let pageToken: string | undefined;
  const seen = new Set<string>();
  let rejected = 0;
  const pages = new Set<string>();
  do {
    const pageKey = pageToken ?? '';
    if (pages.has(pageKey) || pages.size >= 10) throw new Error('Limite ou ciclo de paginação no Gmail.');
    pages.add(pageKey);
    const page = await mailbox.list(query, pageToken);
    for (const id of page.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (seen.size > 200) throw new Error('Mais de 200 candidatos: refine o remetente antes de continuar.');
      const data = await mailbox.get(id);
      if (!Number.isFinite(data.internalDate)) throw new Error('Data de recebimento inválida no Gmail.');
      if (data.internalDate < config.start || data.internalDate >= config.end) continue;
      if (data.raw.length > 14 * 1024 * 1024) throw new Error('E-mail acima do limite de tamanho.');
      const raw = Buffer.from(data.raw, 'base64url');
      if (raw.length > 10 * 1024 * 1024) throw new Error('E-mail acima do limite de 10 MB.');
      const parsed = await simpleParser(raw, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
      const from = parsed.from?.value;
      if (from?.length !== 1 || from[0].address?.toLowerCase() !== config.sender.toLowerCase()) continue;
      try {
        if (!parsed.html) throw new Error('HTML ausente');
        valid.push({ gmailId: id, newsletter: extractHtml(parsed.html, config.editionDate) });
      } catch { rejected++; }
    }
    if (page.nextPageToken && page.nextPageToken === pageToken) throw new Error('Paginação inválida no Gmail.');
    pageToken = page.nextPageToken;
  } while (pageToken);
  if (valid.length > 1) throw new Error('Mais de uma newsletter válida para o dia. Confira as edições antes de continuar.');
  if (valid.length === 1) return valid[0];
  if (rejected) throw new Error(`${rejected} e-mail(s) do remetente encontrados, mas nenhum passou na validação de formato e data.`);
  return null;
}
