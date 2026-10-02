import { load } from 'cheerio';
import { simpleParser } from 'mailparser';
import { ExtractionError, type Newsletter } from './types.js';
import { validate } from './validate.js';

const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const clean = (text: string) => text.replace(/[\u200B-\u200D\uFEFF]/gu, '').replace(/\s+/gu, ' ').trim();
const datePattern = /^(?:segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado|domingo),\s*(\d{1,2}) de ([a-zç]+) de (\d{4})$/iu;

function parseDate(text: string): string {
  const match = datePattern.exec(text);
  if (!match) throw new ExtractionError('Data da edição fora do formato esperado.');
  const day = Number(match[1]);
  const month = months.indexOf(match[2].toLowerCase());
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (month < 0 || year < 2000 || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    throw new ExtractionError('Data da edição inválida.');
  }
  return date.toISOString().slice(0, 10);
}

export function extractHtml(html: string, expectedDate?: string): Newsletter {
  const $ = load(html);
  $('script, style, head, noscript').remove();
  $('br').replaceWith(' ');
  // Only accept the observed sequence: title, paragraph, separator, edition date.
  const blocks = $('h1,h2,h3,h4,h5,h6,p').toArray()
    .map(element => ({ tag: element.tagName, text: clean($(element).text()) }))
    .filter(block => block.text.length > 0);
  const dateIndex = blocks.findIndex(block => datePattern.test(block.text));
  if (dateIndex < 0) throw new ExtractionError('Data da edição não encontrada.');
  const intro = blocks.slice(0, dateIndex);
  const candidates = intro.map((block, index) => ({ ...block, index }))
    .filter(block => /^bom dia\b/iu.test(block.text));
  if (candidates.length !== 1) {
    throw new ExtractionError('Esperado exatamente um parágrafo inicial antes da data.');
  }
  const paragraph = candidates[0];
  const title = intro[paragraph.index - 1];
  if (paragraph.tag !== 'p' || !title || !/^h[1-6]$/u.test(title.tag)) {
    throw new ExtractionError('Estrutura de título e parágrafo alterada.');
  }
  if (intro.slice(paragraph.index + 1).some(block => !/^[.…\s]+$/u.test(block.text))) {
    throw new ExtractionError('Conteúdo inesperado entre o parágrafo e a data.');
  }
  return validate({ title: title.text, message: paragraph.text,
    editionDate: parseDate(blocks[dateIndex].text) }, expectedDate);
}

export async function extractEml(raw: Buffer, expectedDate?: string): Promise<Newsletter> {
  if (raw.length > 10 * 1024 * 1024) throw new ExtractionError('E-mail excede o limite de 10 MB.');
  const email = await simpleParser(raw, {
    skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true,
  });
  if (!email.html) throw new ExtractionError('E-mail sem HTML: formato não suportado nesta versão.');
  return extractHtml(email.html, expectedDate);
}
