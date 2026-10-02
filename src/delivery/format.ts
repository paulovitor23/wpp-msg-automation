import type { Newsletter } from '../newsletter/types.js';

export function formatMessage(newsletter: Newsletter): string {
  const date = newsletter.editionDate.split('-').reverse().join('/');
  return `☀️ ${newsletter.title}\n\n${newsletter.message}\n\nFonte: the news · ${date}`;
}
