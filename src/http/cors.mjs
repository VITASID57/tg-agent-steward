export function corsHeaders(request, allowedOrigins, allowOpaqueOrigin = false) {
  const origin = request.headers.origin;
  if (!origin) return {};
  if (!(allowOpaqueOrigin && origin === 'null') && !sameOrigin(request, origin) && !allowedOrigins.has(origin)) {
    throw Object.assign(new Error(`不允许的网页来源：${origin}`), { statusCode: 403 });
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function sameOrigin(request, origin) {
  try {
    const source = new URL(origin);
    return ['http:', 'https:'].includes(source.protocol) && source.host === request.headers.host;
  } catch { return false; }
}
