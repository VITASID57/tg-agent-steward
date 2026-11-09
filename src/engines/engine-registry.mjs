export class EngineRegistry {
  constructor(engines, { secretStore = null, apiSessions = null, apiEngineFactory = null } = {}) {
    this.engines = new Map(engines.map((engine) => [engine.id, engine]));
    this.secretStore = secretStore;
    this.apiSessions = apiSessions;
    this.apiEngineFactory = apiEngineFactory;
  }

  async forConnection(connection) {
    const fixed = this.engines.get(connection.kind);
    if (fixed) return fixed;
    if (!this.apiEngineFactory || !this.apiSessions) throw Object.assign(new Error(`不支持的连接：${connection.kind}`), { statusCode: 400 });
    const secret = await this.secretStore?.read(`connection:${connection.id}`) ?? '';
    return this.apiEngineFactory({ connection, secret, sessions: this.apiSessions });
  }

  async capabilityFor(connection, options = {}) {
    try { return await (await this.forConnection(connection)).capabilities(options); }
    catch (error) { return { available: false, error: error.message, models: connection.cachedModels.map((id) => ({ id, name: id, efforts: [] })), efforts: [] }; }
  }

  async capabilityForDraft(connection, secret = '', options = {}) {
    try {
      const fixed = this.engines.get(connection.kind);
      if (fixed) return await fixed.capabilities(options);
      if (!this.apiEngineFactory || !this.apiSessions) throw new Error(`不支持的连接：${connection.kind}`);
      return await this.apiEngineFactory({ connection, secret, sessions: this.apiSessions }).capabilities(options);
    } catch (error) {
      return { available: false, error: error.message, models: connection.cachedModels?.map((id) => ({ id, name: id, efforts: [] })) || [], efforts: [] };
    }
  }

  get(id) {
    const engine = this.engines.get(id);
    if (!engine) throw Object.assign(new Error(`不支持的引擎：${id}`), { statusCode: 400 });
    return engine;
  }

  async capabilities() {
    const entries = await Promise.all([...this.engines].map(async ([id, engine]) => {
      try {
        return [id, await engine.capabilities()];
      } catch (error) {
        return [id, { available: false, error: error.message, models: [], efforts: [] }];
      }
    }));
    return Object.fromEntries(entries);
  }
}
