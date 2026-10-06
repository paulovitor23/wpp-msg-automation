import whatsapp from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

export function createWhatsApp() {
  return new whatsapp.Client({
    authStrategy: new whatsapp.LocalAuth({ dataPath: 'data/whatsapp' }),
    webVersionCache: { type: 'local', path: 'data/whatsapp-cache' },
    puppeteer: { headless: true },
  });
}

export async function connectWhatsApp(client: ReturnType<typeof createWhatsApp>) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Tempo de conexão esgotado. Execute o comando novamente.')), 180000);
    const qr = (value: string) => {
      console.log('WhatsApp → Aparelhos conectados → Conectar aparelho. Escaneie o QR:');
      qrcode.generate(value, { small: true });
    };
    const ready = () => finish();
    const failed = () => finish(new Error('Conexão WhatsApp interrompida ou recusada.'));
    const finish = (error?: Error) => {
      clearTimeout(timer);
      client.off('qr', qr);
      client.off('ready', ready);
      client.off('auth_failure', failed);
      client.off('disconnected', failed);
      error ? reject(error) : resolve();
    };
    client.on('qr', qr);
    client.once('ready', ready);
    client.once('auth_failure', failed);
    client.once('disconnected', failed);
    void client.initialize().catch(finish);
  });
}
