const MAX_EVENTS = 80;
const DEDUPE_MS = 60_000;

export class RuntimeEventStore {
  constructor(file, { now = () => new Date() } = {}) {
    this.file = file;
    this.now = now;
  }

  async record(botId, input = {}) {
    const id = clean(botId, 160);
    if (!id) return null;
    const event = {
      at: validDate(input.at) || this.now().toISOString(),
      kind: clean(input.kind, 40) || 'runtime',
      status: ['success', 'warning', 'error', 'info'].includes(input.status) ? input.status : 'info',
      title: redact(clean(input.title, 80) || '运行事件'),
      detail: redact(clean(input.detail, 240)),
    };
    await this.file.update((state = { bots: {} }) => {
      const previous = Array.isArray(state.bots?.[id]) ? state.bots[id] : [];
      const latest = previous[0];
      if (latest && sameEvent(latest, event) && Date.parse(event.at) - Date.parse(latest.at) < DEDUPE_MS) return state;
      return { ...state, bots: { ...(state.bots || {}), [id]: [event, ...previous].slice(0, MAX_EVENTS) } };
    });
    return event;
  }

  async list(botId, limit = 30) {
    const state = await this.file.read();
    const events = Array.isArray(state.bots?.[botId]) ? state.bots[botId] : [];
    return events.slice(0, Math.min(80, Math.max(1, Number(limit) || 30)));
  }

  async removeBot(botId) {
    await this.file.update((state = { bots: {} }) => {
      const bots = { ...(state.bots || {}) }; delete bots[botId];
      return { ...state, bots };
    });
  }
}

function sameEvent(left, right) {
  return left.kind === right.kind && left.status === right.status && left.title === right.title && left.detail === right.detail;
}
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null; }
function redact(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, 'Bearer [已隐藏]')
    .replace(/\b(?:sk|bot)[-_][A-Za-z0-9._-]{8,}\b/giu, '[已隐藏]')
    .replace(/([?&](?:key|token|secret)=)[^&\s]+/giu, '$1[已隐藏]');
}
