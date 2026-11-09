const LIVE_SOURCES = new Set(['live']);
const CLI_KINDS = new Set(['codex', 'claude', 'grok-build']);
const MCP_KINDS = new Set(['mcp-remote', 'mcp-stdio']);

export class ConnectionTester {
  constructor({ controlPlaneStore, secretStore, engines, toolBroker, now = () => new Date() }) {
    Object.assign(this, { controlPlaneStore, secretStore, engines, toolBroker, now });
  }

  async test(connectionId) {
    const state = await this.controlPlaneStore.get();
    const connection = state.connections.find((item) => item.id === connectionId);
    if (!connection) throw Object.assign(new Error('找不到这个连接预设'), { statusCode: 404 });
    let result;
    try { result = await this.#run(connection); }
    catch (error) { result = report('failed', '连接没有通过自检', safe(error)); }
    const stamped = { ...result, at: this.now().toISOString() };
    await this.controlPlaneStore.upsertConnection({ ...connection, lastTest: stamped });
    return stamped;
  }

  async #run(connection) {
    const missing = await this.#missing(connection);
    if (missing.length) return report('failed', '连接信息不完整', missing.join('；'));
    if (MCP_KINDS.has(connection.kind)) {
      const tools = await this.toolBroker.listConnection(connection.id);
      return report('passed', 'MCP 连接可用', `已连通，并读取到 ${tools.length} 个工具。`);
    }
    if (connection.capabilities.includes('chat') || CLI_KINDS.has(connection.kind) || ['elevenlabs', 'comfyui'].includes(connection.kind)) {
      const capability = await this.engines.capabilityFor(connection, { purpose: primaryPurpose(connection) });
      if (!capability.available) return report('failed', '连接不可用', capability.error || '提供方没有返回可用能力。');
      const modelCount = Array.isArray(capability.models) ? capability.models.length : 0;
      if (CLI_KINDS.has(connection.kind) || LIVE_SOURCES.has(capability.source)) {
        return report('passed', '连接已通过实时自检', modelCount ? `运行入口可用，并读取到 ${modelCount} 个模型。` : '运行入口可用。');
      }
      return report('warning', '基础配置已就绪', modelCount
        ? `当前使用保存或内置目录（${modelCount} 个模型），未完成提供方实时验证。`
        : '配置已保存，但这类连接没有安全的统一探测接口；请在实际使用后确认。');
    }
    return report('warning', '基础配置已就绪', '这类连接没有安全的统一探测接口；自检未发起付费生成请求。');
  }

  async #missing(connection) {
    const missing = [];
    const hasSecret = await this.secretStore.has(`connection:${connection.id}`);
    if (requiresUrl(connection.kind) && !connection.baseUrl) missing.push('缺少服务地址');
    if (requiresSecret(connection.kind) && !hasSecret) missing.push('缺少密钥');
    if (['edge-tts', 'whisper-local', 'mcp-stdio'].includes(connection.kind) && !connection.options?.command) missing.push('缺少部署主机命令');
    return missing;
  }
}

function report(status, title, detail) { return { status, ok: status === 'passed', title, message: detail }; }
function primaryPurpose(connection) {
  return ['chat', 'tts', 'image', 'stt'].find((item) => connection.capabilities.includes(item)) || 'chat';
}
function requiresUrl(kind) { return !['codex', 'claude', 'grok-build', 'edge-tts', 'whisper-local', 'mcp-stdio'].includes(kind); }
function requiresSecret(kind) {
  return ['openai-compatible', 'anthropic-compatible', 'vertex-ai', 'minimax', 'elevenlabs', 'novelai'].includes(kind);
}
function safe(error) {
  return String(error?.message || error)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, 'Bearer [已隐藏]')
    .replace(/\b(?:sk|bot)[-_][A-Za-z0-9._-]{8,}\b/giu, '[已隐藏]')
    .replace(/([?&](?:key|token|secret)=)[^&\s]+/giu, '$1[已隐藏]')
    .slice(0, 500);
}
