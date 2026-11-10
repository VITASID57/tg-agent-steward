export async function handleCommand({ text, chatId, bot, manager, controlPlaneStore, pairing, engines, imageService, toolBroker }) {
  const [raw, arg = ''] = text.trim().split(/\s+/, 2);
  const command = raw.split('@')[0].toLowerCase();
  if (command === '/pair') {
    const ok = await pairing.redeem(bot.id, arg, chatId);
    return { handled: true, text: ok ? '配对成功。现在可以直接和我说话了。' : '配对码无效或已过期。' };
  }
  if (!bot.telegram.allowedChatIds.includes(String(chatId))) return { handled: true, text: '这个账号还没有获得访问权限。请让主人在控制页生成一次性配对码。' };
  if (command === '/draw') {
    if (!arg) return { handled: true, text: '请在 /draw 后面写画面描述。' };
    if (!bot.image.enabled || !bot.image.imageProfileId) return { handled: true, text: '这个 Bot 还没有启用生图路线。' };
    const result = await imageService.generate(bot.image.imageProfileId, text.trim().slice(raw.length).trim());
    return { handled: true, image: result, text: result.fallbackNote ? `已使用备用线路。${result.fallbackNote}` : '' };
  }
  if (command === '/tools') {
    if (!bot.tools.enabled || !bot.tools.connectionIds.length) return { handled: true, text: '这个 Bot 还没有启用外部工具。' };
    const tools = await toolBroker.listForBot(bot);
    return { handled: true, text: tools.length ? tools.map((item) => `• ${item.name}${item.description ? ` — ${item.description}` : ''}`).join('\n') : '没有发现允许使用的工具。' };
  }
  if (command === '/tool') {
    const call = parseToolCall(text.trim().slice(raw.length).trim());
    if (!call) return { handled: true, text: '用法：/tool 工具名 {"参数":"值"}' };
    const result = await toolBroker.callForBot(bot, call.name, call.arguments, { manual: true });
    return { handled: true, text: formatToolResult(result.output), images: result.images, imageErrors: result.imageErrors };
  }
  if (command === '/new') return { handled: true, text: (await manager.newSession(chatId, bot.id), '已开启新会话。') };
  if (command === '/stop') {
    const result = await manager.stop(chatId, bot.id);
    return { handled: true, text: result.ok ? '已经停下。' : '现在没有正在生成的回复。' };
  }
  if (command === '/compact') {
    const result = await manager.compact(chatId, bot.id);
    return { handled: true, text: result.ok ? '上下文已经整理好。' : '当前还没有可整理的会话。' };
  }
  if (command === '/status') {
    const status = await manager.status(chatId, bot.id);
    const c = status.configured;
    const usage = formatUsage(status.chat?.lastUsage);
    return { handled: true, text: `引擎：${c.engine} · ${c.runtimeMode === 'agent' ? '完整 Agent' : '纯聊天'}\n模型：${c.model || '后端默认'}\n档位：${c.effort || '后端默认'}\n会话：${status.chat?.sessionId ? '已连接' : '尚未建立'}${usage ? `\n${usage}` : ''}` };
  }
  if (['/model', '/effort'].includes(command)) {
    const key = command.slice(1);
    if (!arg) return { handled: true, text: `当前 ${key}：${bot.chat[key] || '后端默认'}` };
    const state = await controlPlaneStore.get();
    const connection = state.connections.find((item) => item.id === bot.chat.connectionId);
    let capability;
    try { capability = await engines.capabilityFor(connection); }
    catch (error) { return { handled: true, text: error.message }; }
    if (key === 'model') {
      const model = capability.models.find((item) => item.id === arg);
      if (!model && !capability.supportsManualModel) return { handled: true, text: `模型不可用：${arg}` };
      const efforts = model.efforts?.length ? model.efforts : capability.efforts;
      if (bot.chat.effort && efforts.length && !efforts.includes(bot.chat.effort)) return { handled: true, text: `当前档位 ${bot.chat.effort} 不适用于 ${arg}，请先用 /effort 调整。` };
    }
    if (key === 'effort' && capability.efforts.length && !capability.efforts.includes(arg)) return { handled: true, text: `档位不可用：${arg}` };
    await controlPlaneStore.upsertBot({ ...bot, chat: { ...bot.chat, [key]: arg } });
    return { handled: true, text: `${key} 已设置为 ${arg}，将在下一轮实际请求中验证。` };
  }
  return { handled: false };
}

function parseToolCall(value) {
  const split = value.search(/\s/u); const name = split < 0 ? value : value.slice(0, split); const raw = split < 0 ? '{}' : value.slice(split).trim();
  if (!name) return null;
  try { const args = JSON.parse(raw || '{}'); return args && typeof args === 'object' && !Array.isArray(args) ? { name, arguments: args } : null; }
  catch { return null; }
}

function formatToolResult(result) {
  const value = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return value.length > 3800 ? `${value.slice(0, 3800)}\n…（结果已截断）` : value;
}

function formatUsage(value) {
  if (!value || typeof value !== 'object') return '';
  const total = value.total_tokens ?? value.totalTokens ?? value.total ?? value.totalTokenUsage?.totalTokens;
  const input = value.input_tokens ?? value.inputTokens ?? value.totalTokenUsage?.inputTokens;
  const output = value.output_tokens ?? value.outputTokens ?? value.totalTokenUsage?.outputTokens;
  const cache = value.cache_read_input_tokens ?? value.cacheReadInputTokens ?? value.totalTokenUsage?.cachedInputTokens;
  const parts = [];
  if (Number.isFinite(total)) parts.push(`总 ${total}`);
  else {
    if (Number.isFinite(input)) parts.push(`输入 ${input}`);
    if (Number.isFinite(output)) parts.push(`输出 ${output}`);
  }
  if (Number.isFinite(cache) && cache > 0) parts.push(`缓存命中 ${cache}`);
  return parts.length ? `最近用量：${parts.join(' · ')} tokens` : '';
}
