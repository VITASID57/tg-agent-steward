import { readFile, writeFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const entryHtml = (await readFile(new URL('./page.html', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const plugin = {
  schemaVersion: 2,
  appId: 'lumenkeep-mimi-town',
  version,
  name: '栖光庭',
  icon: null,
  requestedCapabilities: ['resident-read', 'network'],
  contributions: { page: { entryHtml } },
};

await writeFile(new URL('./lumenkeep.mimi-app.json', import.meta.url), `${JSON.stringify(plugin, null, 2)}\n`);
