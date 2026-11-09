const QUERY_SECRET_NAMES = new Set(['token', 'key', 'api_key', 'apikey', 'access_token']);

export function prepareConnectionInput(input = {}) {
  const body = structuredClone(input);
  const extracted = extractQuerySecret(body.baseUrl);
  if (!extracted) return { body, secret: string(body.secret) };
  body.baseUrl = extracted.baseUrl;
  body.options = { ...(body.options || {}), authType: 'query', authName: extracted.name };
  return { body, secret: string(body.secret) || extracted.value };
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
