import { randomUUID } from 'node:crypto';

const EMPTY = { current: { id: 'initial', text: '', source: 'local', residentId: null, residentName: null, createdAt: null }, history: [] };

export class PersonaStore {
  constructor(file, maxVersions = 50) {
    this.file = file;
    this.maxVersions = maxVersions;
  }

  async get() {
    return this.file.read();
  }

  async save(input) {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) throw Object.assign(new Error('人设正文不能为空'), { statusCode: 400 });
    const now = new Date().toISOString();
    return this.file.update((state = structuredClone(EMPTY)) => {
      const current = {
        id: randomUUID(), text, source: clean(input.source) || 'local',
        residentId: clean(input.residentId) || null,
        residentName: clean(input.residentName) || null, createdAt: now,
      };
      const history = state.current?.text ? [state.current, ...(state.history ?? [])] : (state.history ?? []);
      return { current, history: history.slice(0, this.maxVersions) };
    });
  }

  async rollback(id) {
    const state = await this.get();
    const version = state.history.find((item) => item.id === id);
    if (!version) throw Object.assign(new Error('找不到这个人设版本'), { statusCode: 404 });
    return this.save({ ...version, source: `rollback:${id}` });
  }
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export { EMPTY as EMPTY_PERSONA_STATE };
