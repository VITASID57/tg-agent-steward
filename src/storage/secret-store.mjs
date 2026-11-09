export class SecretStore {
  constructor(file) { this.file = file; }
  async has(key) { return Boolean((await this.file.read()).values?.[key]); }
  async read(key) { return (await this.file.read()).values?.[key] ?? ''; }
  async write(key, value) {
    const secret = typeof value === 'string' ? value.trim() : '';
    if (!secret) return this.has(key);
    await this.file.update((state = { values: {} }) => ({ ...state, values: { ...(state.values ?? {}), [key]: secret } }));
    return true;
  }
  async remove(key) {
    await this.file.update((state = { values: {} }) => { const values = { ...(state.values ?? {}) }; delete values[key]; return { ...state, values }; });
  }
}
