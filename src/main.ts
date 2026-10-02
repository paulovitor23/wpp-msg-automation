import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { extractEml } from './newsletter/extract.js';
import { formatMessage } from './delivery/format.js';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { json: { type: 'boolean' }, 'expected-date': { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log('Uso: npm run extract -- "caminho/email.eml" [--json] [--expected-date YYYY-MM-DD]');
  } else {
    if (positionals.length !== 1) throw new Error('Informe um arquivo .eml. Use --help para ver o comando.');
    const expectedDate = values['expected-date'];
    if (expectedDate && !/^\d{4}-\d{2}-\d{2}$/u.test(expectedDate)) throw new Error('Use a data no formato YYYY-MM-DD.');
    const info = await stat(positionals[0]);
    if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('Informe um arquivo de até 10 MB.');
    const newsletter = await extractEml(await readFile(positionals[0]), expectedDate);
    console.log(values.json ? JSON.stringify(newsletter, null, 2) : formatMessage(newsletter));
  }
} catch (error) {
  console.error(`Extração interrompida: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
  process.exitCode = 1;
}
