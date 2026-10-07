import 'dotenv/config';
import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { createWhatsApp, connectWhatsApp } from './delivery/whatsapp.js';
import { sendOnce, checkSendAllowed } from './delivery/send.js';
import { authorize } from './gmail/auth.js';
import { createMailbox, findNewsletter } from './gmail/client.js';
import { gmailConfig } from './config.js';
import { openHistory } from './scheduler.js';
import { checkWhatsAppSafety } from './delivery/safety.js';

let client: ReturnType<typeof createWhatsApp> | undefined;
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { confirm: { type: 'boolean' } },
  });
  const command = positionals[0];
  if (positionals.length !== 1 || !['auth', 'groups', 'send'].includes(command)) {
    throw new Error('Use npm run whatsapp:auth, whatsapp:groups ou npm run whatsapp:send -- --confirm.');
  }
  const group = process.env.WHATSAPP_GROUP_ID ?? '';
  if (command === 'send') checkWhatsAppSafety(group);
  if (command === 'send' && values.confirm !== true) {
    throw new Error('Envio bloqueado por segurança. Para confirmar manualmente, use: npm run whatsapp:send -- --confirm');
  }
  await mkdir('data', { recursive: true, mode: 0o700 });
  if (command === 'send') {
    const db = openHistory('data/history.sqlite');
    try { checkSendAllowed(db); } finally { db.close(); }
  }
  const result = command === 'send'
    ? await findNewsletter(createMailbox(await authorize()), gmailConfig()) : null;
  if (command === 'send' && !result) throw new Error('Nenhuma newsletter válida encontrada para hoje.');
  await mkdir('data', { recursive: true, mode: 0o700 });
  client = createWhatsApp();
  const shutdown = () => { void client?.destroy().finally(() => process.exit(130)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await connectWhatsApp(client);
  if (command === 'auth') console.log('WhatsApp conectado. Sessão salva localmente.');
  if (command === 'groups') {
    const groups = (await client.getChats()).filter(chat => chat.isGroup);
    for (const chat of groups) console.log(`${chat.name} → ${chat.id._serialized}`);
    if (!groups.length) console.log('Nenhum grupo encontrado nessa conta.');
  }
  if (command === 'send' && result) {
    const chat = await client.getChatById(group);
    if (!chat.isGroup || chat.id._serialized !== group) throw new Error('Destino não corresponde ao grupo configurado.');
    console.log(`Enviando a edição ${result.newsletter.editionDate} para: ${chat.name}`);
    const db = openHistory('data/history.sqlite');
    try {
      await sendOnce(db, group, result.gmailId, result.newsletter, async text => {
        if (await client!.getState() !== 'CONNECTED') throw new Error('WhatsApp desconectado.');
        const sent = await client!.sendMessage(group, text, { sendSeen: false, linkPreview: false });
        return sent?.id?._serialized;
      });
      console.log('Envio retornou sucesso. Isso não confirma leitura pelos participantes.');
    } finally { db.close(); }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha na operação WhatsApp.');
  process.exitCode = 1;
} finally { await client?.destroy().catch(() => {}); }
