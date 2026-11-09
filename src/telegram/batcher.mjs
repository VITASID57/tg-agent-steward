export class MessageBatcher {
  constructor(handler) {
    this.handler = handler;
    this.pending = new Map();
  }

  push(chatId, text, delayMs, context = {}) {
    const key = String(chatId);
    const current = this.pending.get(key) ?? { texts: [], resolvers: [], timer: null, context };
    current.texts.push(text);
    current.context = context;
    const promise = new Promise((resolve, reject) => current.resolvers.push({ resolve, reject }));
    clearTimeout(current.timer);
    current.timer = setTimeout(() => this.#flush(key), delayMs);
    this.pending.set(key, current);
    return promise;
  }

  async #flush(key) {
    const current = this.pending.get(key);
    if (!current) return;
    this.pending.delete(key);
    try {
      const result = await this.handler(key, current.texts.join('\n'), current.context);
      current.resolvers.forEach(({ resolve }) => resolve(result));
    } catch (error) {
      current.resolvers.forEach(({ reject }) => reject(error));
    }
  }
}
