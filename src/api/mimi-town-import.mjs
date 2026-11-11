import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readJson } from '../http/body.mjs';
import { json } from '../http/responses.mjs';

const base = '/api/integrations/mimi-town';
const secretKey = 'integration:mimi-town:import-digest';
const fields = [
  ['personality', '性格'], ['appearance', '外貌'], ['selfDescription', '自我介绍'],
  ['aboutUser', '关于你'], ['callsUser', '对你的称呼'], ['userNotes', '备注'],
];

export const mimiTownTokenPath = `${base}/token`;

export function createMimiTownImport({ controlPlaneStore, secretStore, now = () => new Date() }) {
  return {
    matches(path, method) {
      return (path === `${base}/status` && ['GET', 'OPTIONS'].includes(method))
        || (path === `${base}/profiles` && ['POST', 'OPTIONS'].includes(method));
    },
    async handle(request, response, headers) {
      const received = /^Bearer (mt_[A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
      const expected = received && await secretStore.read(secretKey);
      if (!expected || !/^[a-f0-9]{64}$/.test(expected) || !timingSafeEqual(digest(received), Buffer.from(expected, 'hex'))) {
        throw badRequest('口令不对', 401);
      }
      if (request.method === 'GET') return json(response, 200, { ok: true }, headers);

      const pack = await readJson(request);
      const profile = await controlPlaneStore.upsertProfile(profileFromPack(pack, now()));
      return json(response, 201, { id: profile.id, name: profile.name }, headers);
    },
    async manage(request, response, headers) {
      headers = { ...headers, 'cache-control': 'no-store' };
      if (request.method === 'GET') {
        return json(response, 200, { configured: await secretStore.has(secretKey) }, headers);
      }
      if (request.method === 'POST') {
        const token = `mt_${randomBytes(32).toString('base64url')}`;
        await secretStore.write(secretKey, digest(token).toString('hex'));
        return json(response, 201, { configured: true, token }, headers);
      }
      if (request.method === 'DELETE') {
        await secretStore.remove(secretKey);
        return json(response, 200, { configured: false }, headers);
      }
      throw badRequest('接口不支持这个操作', 405);
    },
  };
}

function digest(token) {
  return createHash('sha256').update(token).digest();
}

function profileFromPack(pack, date) {
  const name = clean(pack?.resident?.displayName);
  const residentId = clean(pack?.resident?.residentId);
  if (pack?.schemaVersion !== 1 || !name || !residentId || !pack.persona
    || typeof pack.persona !== 'object' || Array.isArray(pack.persona)) {
    throw badRequest('缺少已确认的居民人设');
  }

  const suffix = ` · 来自棉棉云小镇 · ${date.toISOString().slice(0, 10)}`;
  const blocks = fields.flatMap(([id, title]) => {
    const body = clean(pack.persona[id]);
    return body ? [{ id, title, body }] : [];
  });
  const anniversary = [clean(pack.persona.anniversary?.title), clean(pack.persona.anniversary?.since)].filter(Boolean);
  if (anniversary.length) blocks.push({ id: 'anniversary', title: '纪念日', body: anniversary.join(' · ') });
  return { name: `${name.slice(0, 80 - suffix.length)}${suffix}`, residentId, source: 'mimi-town', blocks };
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function badRequest(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
