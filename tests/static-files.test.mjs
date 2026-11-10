import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticFiles } from '../src/http/static-files.mjs';

test('static code is never served from a stale browser cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lumenkeep-static-'));
  await writeFile(join(root, 'app.js'), 'export const ready = true;');
  let status; let headers; let body;
  const served = await staticFiles(root)('/app.js', {
    writeHead(nextStatus, nextHeaders) { status = nextStatus; headers = nextHeaders; },
    end(nextBody) { body = nextBody; },
  });
  assert.equal(served, true);
  assert.equal(status, 200);
  assert.equal(headers['cache-control'], 'no-store');
  assert.match(headers['content-type'], /text\/javascript/u);
  assert.equal(body.toString(), 'export const ready = true;');
});
