const GROUP_ID = /^\d+(?:-\d+)?@g\.us$/;
const DEFAULT_MAX_MESSAGE_LENGTH = 4096;

export function validateGroupId(group: string): void {
  if (!GROUP_ID.test(group)) {
    throw new Error('WHATSAPP_GROUP_ID inválido. Configure no .env com o ID mostrado por whatsapp:groups.');
  }
}

export function checkWhatsAppSafety(group: string): void {
  validateGroupId(group);
  if (process.env.WHATSAPP_SEND_ENABLED !== 'true') {
    throw new Error('Envio desabilitado. Defina WHATSAPP_SEND_ENABLED=true no .env.');
  }
  if (process.env.WHATSAPP_CONSENT_CONFIRMED !== 'true') {
    throw new Error('Envio bloqueado: confirme o opt-in de todos os participantes com WHATSAPP_CONSENT_CONFIRMED=true.');
  }
}

export function validateMessageSize(text: string): void {
  const configured = process.env.WHATSAPP_MAX_MESSAGE_LENGTH ?? String(DEFAULT_MAX_MESSAGE_LENGTH);
  const max = Number(configured);
  if (!Number.isInteger(max) || max < 1 || max > DEFAULT_MAX_MESSAGE_LENGTH) {
    throw new Error('WHATSAPP_MAX_MESSAGE_LENGTH deve ser um inteiro entre 1 e 4096.');
  }
  if (text.length > max) {
    throw new Error(`Mensagem excede o limite configurado de ${max} caracteres.`);
  }
}
