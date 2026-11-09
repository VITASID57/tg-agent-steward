import { randomUUID } from 'node:crypto';

export class ApiSessionStore {
  constructor(file) { this.file = file; }
  async get(id) { return (await this.file.read()).sessions?.[id] ?? null; }
  async create(connectionId, instructions) {
    const id = randomUUID();
    await this.file.update((state = { sessions: {} }) => ({ ...state, sessions: { ...(state.sessions ?? {}),
      [id]: { connectionId, instructions, messages: [], createdAt: new Date().toISOString() } } }));
    return id;
  }
  async append(id, ...messages) {
    await this.file.update((state = { sessions: {} }) => {
      const current = state.sessions?.[id];
      if (!current) return state;
      return { ...state, sessions: { ...state.sessions, [id]: { ...current, messages: [...current.messages, ...messages] } } };
    });
  }
}
