import { ExtractionError, type Newsletter } from './types.js';

export function validate(newsletter: Newsletter, expectedDate?: string): Newsletter {
  const { title, message, editionDate } = newsletter;
  if (!title || title.length > 160 || /^[.…\s]+$/u.test(title)) {
    throw new ExtractionError('Título ausente ou fora do formato esperado.');
  }
  if (!/^bom dia\b/iu.test(message) || message.length < 30 || message.length > 1500) {
    throw new ExtractionError('Parágrafo inicial ausente ou fora do tamanho/formato esperado.');
  }
  if (/quick\s+takes|\bdescubra\s*:/iu.test(`${title} ${message}`)) {
    throw new ExtractionError('A extração contém conteúdo de outra seção.');
  }
  if (expectedDate && editionDate !== expectedDate) {
    throw new ExtractionError(`Edição ${editionDate} diferente da data esperada ${expectedDate}.`);
  }
  return newsletter;
}
