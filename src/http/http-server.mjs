import { createServer } from 'node:http';
import { corsHeaders } from './cors.mjs';
import { errorJson, json, noContent } from './responses.mjs';

export function startHttpServer({ host, port, allowedOrigins, authenticate, apiHandler, serveStatic, mimiTown, authRequired = true, logger = console }) {
  const server = createServer(async (request, response) => {
    let headers = {};
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      const importRoute = mimiTown?.matches(url.pathname, request.method);
      headers = corsHeaders(request, allowedOrigins, Boolean(mimiTown && (importRoute || url.pathname === '/healthz')));
      if (request.method === 'OPTIONS') return noContent(response, headers);
      if (url.pathname === '/healthz') return json(response, 200, { ok: true, authRequired }, headers);
      if (importRoute) {
        headers = { ...headers, 'cache-control': 'no-store' };
        return await mimiTown.handle(request, response, headers);
      }
      if (url.pathname.startsWith('/api/')) {
        authenticate(request);
        return await apiHandler(request, response, url, headers);
      }
      if (await serveStatic(url.pathname, response)) return;
      json(response, 404, { error: 'Not found' }, headers);
    } catch (error) {
      logger.error(`HTTP ${request.method} ${request.url}: ${error.message}`);
      errorJson(response, error, headers);
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
