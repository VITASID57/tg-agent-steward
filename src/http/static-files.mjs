import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

export function staticFiles(root) {
  return async (pathname, response) => {
    const route = pathname === '/' ? '/index.html' : pathname;
    const relative = normalize(route).replace(/^([/\\])+/, '');
    if (relative.startsWith('..')) return false;
    try {
      const body = await readFile(join(root, relative));
      response.writeHead(200, { 'content-type': TYPES[extname(relative)] ?? 'application/octet-stream', 'content-length': body.length });
      response.end(body);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  };
}
