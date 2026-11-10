const QUERY_SECRET_NAMES = new Set(['token', 'key', 'api_key', 'apikey', 'access_token']);

export function prepareConnectionInput(input = {}) {
  const body = structuredClone(input);
  validateBaseUrl(body.baseUrl, body.kind);
  const extracted = extractQuerySecret(body.baseUrl);
  if (!extracted) return { body, secret: string(body.secret) };
  body.baseUrl = extracted.baseUrl;
  body.options = { ...(body.options || {}), authType: 'query', authName: extracted.name };
  return { body, secret: string(body.secret) || extracted.value };
}

function validateBaseUrl(value, kind) {
  const raw = string(value);
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    const message = kind === 'vertex-ai'
      ? 'Vertex 接口地址必须以 https:// 开头；服务账号邮箱不能填在这里。'
      : '接口地址必须是以 http:// 或 https:// 开头的完整网址。';
    throw Object.assign(new Error(message), { statusCode: 400 });
  }
}

function extractQuerySecret(value) {
  try {
    const url = new URL(String(value || ''));
    for (const [name, secret] of url.searchParams) {
      if (!QUERY_SECRET_NAMES.has(name.toLowerCase()) || !secret) continue;
      url.searchParams.delete(name);
      return { baseUrl: url.toString().replace(/\?$/u, ''), name, value: secret };
    }
  } catch { /* Non-URL values are validated by the connection itself. */ }
  return null;
}

function string(value) { return typeof value === 'string' ? value.trim() : ''; }
