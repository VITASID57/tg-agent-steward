import { readJson } from '../http/body.mjs';
import { json } from '../http/responses.mjs';
import { normalizeSettings } from '../config/validate.mjs';

export function createApiHandler(services) {
  const { settingsStore, personaStore, controlPlaneStore, secretStore, manager, engines, pairing, telegramService, wechatService,
    stickerAssetStore, toolBroker, wakeService, eventStore, connectionTester } = services;
  return async (request, response, url, headers) => {
    const path = url.pathname;
    if (request.method === 'GET' && path === '/api/status') {
      const [controlPlane, persona, usage, runtime] = await Promise.all([
        controlPlaneStore.get(), personaStore.get(), manager.usage().catch(() => null), manager.runtimeStatus(),
      ]);
      const bot = controlPlane.bots[0];
      if (!bot) return json(response, 200, { ok: true, controlPlane, telegram: telegramService.status(controlPlane), wechat: wechatService.status(controlPlane) }, headers);
      const connection = controlPlane.connections.find((item) => item.id === bot.chat.connectionId);
      const capabilities = connection ? { [connection.kind]: await engines.capabilityFor(connection) } : {};
      const settings = connection ? legacySettings(bot, connection) : null;
      return json(response, 200, {
        ok: true, settings, capabilities, personaVersion: persona.current?.id ?? null, usage, runtime,
        telegram: telegramService.status(controlPlane),
        wechat: wechatService.status(controlPlane),
        secrets: { telegramBotToken: telegramService.status(controlPlane).configured, adminToken: true },
      }, headers);
    }
    if (request.method === 'GET' && path === '/api/control-plane') {
      return json(response, 200, await publicControlPlane(await controlPlaneStore.get(), secretStore, telegramService, wechatService), headers);
    }
    if (request.method === 'POST' && path === '/api/connections') {
      const body = await readJson(request); const saved = await controlPlaneStore.upsertConnection(body);
      if (body.secret) await secretStore.write(`connection:${saved.id}`, body.secret);
      return json(response, 201, await decorateConnection(saved, secretStore), headers);
    }
    if (request.method === 'POST' && path === '/api/connections/test') {
      const body = await readJson(request);
      if (!body.connectionId) throw Object.assign(new Error('缺少 connectionId'), { statusCode: 400 });
      return json(response, 200, await connectionTester.test(String(body.connectionId)), headers);
    }
    const connectionId = resourceId(path, '/api/connections/');
    if (connectionId && request.method === 'PUT') {
      const body = await readJson(request); const saved = await controlPlaneStore.upsertConnection({ ...body, id: connectionId });
      if (body.secret) await secretStore.write(`connection:${saved.id}`, body.secret);
      return json(response, 200, await decorateConnection(saved, secretStore), headers);
    }
    if (connectionId && request.method === 'DELETE') {
      await controlPlaneStore.removeConnection(connectionId); await secretStore.remove(`connection:${connectionId}`);
      return json(response, 200, { ok: true }, headers);
    }
    if (request.method === 'POST' && path === '/api/profiles') return json(response, 201, await controlPlaneStore.upsertProfile(await readJson(request)), headers);
    const profileId = resourceId(path, '/api/profiles/');
    if (profileId && request.method === 'PUT') return json(response, 200, await controlPlaneStore.upsertProfile({ ...(await readJson(request)), id: profileId }), headers);
    if (request.method === 'POST' && path === '/api/voice-profiles') return json(response, 201, await controlPlaneStore.upsertVoiceProfile(await readJson(request)), headers);
    const voiceId = resourceId(path, '/api/voice-profiles/');
    if (voiceId && request.method === 'PUT') return json(response, 200, await controlPlaneStore.upsertVoiceProfile({ ...(await readJson(request)), id: voiceId }), headers);
    if (request.method === 'POST' && path === '/api/image-profiles') return json(response, 201, await controlPlaneStore.upsertImageProfile(await readJson(request)), headers);
    const imageId = resourceId(path, '/api/image-profiles/');
    if (imageId && request.method === 'PUT') return json(response, 200, await controlPlaneStore.upsertImageProfile({ ...(await readJson(request)), id: imageId }), headers);
    if (request.method === 'POST' && path === '/api/sticker-packs') return json(response, 201, await controlPlaneStore.upsertStickerPack(await readJson(request)), headers);
    const stickerPackId = resourceId(path, '/api/sticker-packs/');
    if (stickerPackId && request.method === 'PUT') return json(response, 200, await controlPlaneStore.upsertStickerPack({ ...(await readJson(request)), id: stickerPackId }), headers);
    if (stickerPackId && request.method === 'DELETE') { await controlPlaneStore.removeStickerPack(stickerPackId); return json(response, 200, { ok: true }, headers); }
    if (request.method === 'POST' && path === '/api/sticker-assets') {
      return json(response, 201, await stickerAssetStore.save(await readJson(request, 3 * 1024 * 1024)), headers);
    }
    const stickerAssetId = resourceId(path, '/api/sticker-assets/');
    if (stickerAssetId && request.method === 'GET') {
      const asset = await stickerAssetStore.read(stickerAssetId);
      response.writeHead(200, { 'content-type': asset.mime, 'content-length': asset.data.length, 'cache-control': 'private, max-age=3600', ...headers });
      response.end(asset.data); return;
    }
    if (stickerAssetId && request.method === 'DELETE') {
      const state = await controlPlaneStore.get();
      if (state.stickerPacks.some((pack) => pack.stickers.some((item) => item.assetId === stickerAssetId))) {
        throw Object.assign(new Error('这个图片仍被表情包引用'), { statusCode: 409 });
      }
      await stickerAssetStore.remove(stickerAssetId); return json(response, 200, { ok: true }, headers);
    }
    if (request.method === 'POST' && path === '/api/bots') {
      const body = await readJson(request); const saved = await controlPlaneStore.upsertBot(body);
      if (body.telegramToken) await secretStore.write(`telegram:${saved.id}`, body.telegramToken);
      await reconcileChannels(telegramService, wechatService);
      return json(response, 201, await decorateBot(saved, secretStore, telegramService, wechatService), headers);
    }
    const botId = resourceId(path, '/api/bots/');
    if (botId && request.method === 'PUT') {
      const body = await readJson(request); const saved = await controlPlaneStore.upsertBot({ ...body, id: botId });
      if (body.telegramToken) await secretStore.write(`telegram:${saved.id}`, body.telegramToken);
      await reconcileChannels(telegramService, wechatService);
      return json(response, 200, await decorateBot(saved, secretStore, telegramService, wechatService), headers);
    }
    if (botId && request.method === 'DELETE') {
      await controlPlaneStore.removeBot(botId); await secretStore.remove(`telegram:${botId}`); await secretStore.remove(`wechat:${botId}`);
      await eventStore?.removeBot(botId);
      await reconcileChannels(telegramService, wechatService);
      return json(response, 200, { ok: true }, headers);
    }
    if (request.method === 'POST' && path === '/api/wechat/login/start') {
      const body = await readJson(request); return json(response, 200, await wechatService.beginLogin(requiredBotId(body)), headers);
    }
    if (request.method === 'GET' && path === '/api/wechat/login/status') {
      return json(response, 200, await wechatService.loginStatus(requiredQueryBotId(url)), headers);
    }
    if (request.method === 'POST' && path === '/api/wechat/login/verify') {
      const body = await readJson(request);
      return json(response, 200, await wechatService.submitVerifyCode(requiredBotId(body), body.code), headers);
    }
    if (request.method === 'DELETE' && path === '/api/wechat/account') {
      return json(response, 200, await wechatService.disconnect(requiredQueryBotId(url)), headers);
    }
    if (request.method === 'GET' && path === '/api/settings') {
      const state = await controlPlaneStore.get(); const bot = state.bots[0];
      return json(response, 200, legacySettings(bot, state.connections.find((item) => item.id === bot.chat.connectionId)), headers);
    }
    if (request.method === 'PUT' && path === '/api/settings') {
      const raw = await readJson(request);
      if (raw.engine !== undefined && !['codex', 'claude'].includes(raw.engine)) {
        throw Object.assign(new Error(`不支持的引擎：${raw.engine}`), { statusCode: 400 });
      }
      const next = normalizeSettings(raw); const state = await controlPlaneStore.get();
      const connection = state.connections.find((item) => item.kind === next.engine);
      if (!connection) throw Object.assign(new Error(`还没有 ${next.engine} 连接预设`), { statusCode: 409 });
      await assertConnectionSelection(next, connection, engines);
      await controlPlaneStore.upsertConnection({ ...connection, options: next.engine === 'codex'
        ? { ...connection.options, workingDirectory: next.workingDirectory, ...next.codex }
        : { ...connection.options, workingDirectory: next.workingDirectory, ...next.claude } });
      const bot = state.bots[0];
      await controlPlaneStore.upsertBot({ ...bot, enabled: next.telegram.enabled, telegram: next.telegram,
        chat: { ...bot.chat, connectionId: connection.id, model: next.model, effort: next.effort } });
      await telegramService.reconcile();
      return json(response, 200, next, headers);
    }
    if (request.method === 'GET' && path === '/api/models') {
      const state = await controlPlaneStore.get();
      const id = url.searchParams.get('connectionId');
      const connection = state.connections.find((item) => item.id === id) ?? state.connections.find((item) => item.kind === url.searchParams.get('engine')) ?? state.connections[0];
      if (!connection) throw Object.assign(new Error('请先保存连接预设'), { statusCode: 409 });
      const purpose = ['chat', 'tts', 'stt', 'image'].includes(url.searchParams.get('purpose')) ? url.searchParams.get('purpose') : 'chat';
      return json(response, 200, await engines.capabilityFor(connection, { purpose }), headers);
    }
    if (request.method === 'GET' && path === '/api/mcp/tools') {
      const connectionId = url.searchParams.get('connectionId'); if (!connectionId) throw Object.assign(new Error('缺少 connectionId'), { statusCode: 400 });
      return json(response, 200, { tools: await toolBroker.listConnection(connectionId) }, headers);
    }
    if (request.method === 'GET' && path === '/api/bot-diagnostics') {
      const botId = requiredQueryBotId(url);
      const [diagnostics, usage, wake, events] = await Promise.all([
        manager.diagnostics(botId), manager.usage(botId).catch((error) => ({ note: error.message })),
        wakeService.status(botId), eventStore?.list(botId, 30) || [],
      ]);
      return json(response, 200, { ...diagnostics, usage, wake, events }, headers);
    }
    if (request.method === 'POST' && path === '/api/wake/run') {
      const body = await readJson(request); const state = await controlPlaneStore.get(); const bot = state.bots.find((item) => item.id === body.botId);
      if (!bot?.wake?.targetChatId) throw Object.assign(new Error('Bot 没有配置唤醒目标'), { statusCode: 409 });
      const result = bot.channel?.type === 'wechat-clawbot'
        ? await wechatService.proactive(bot.id, bot.wake.targetChatId, bot.wake.prompt, { manualWake: true })
        : await telegramService.proactive(bot.id, bot.wake.targetChatId, bot.wake.prompt, { manualWake: true });
      return json(response, 200, result, headers);
    }
    if (request.method === 'POST' && path === '/api/wake/tick') { await wakeService.tick(); return json(response, 200, { ok: true }, headers); }
    if (request.method === 'GET' && path === '/api/persona') return json(response, 200, await personaStore.get(), headers);
    if (request.method === 'PUT' && path === '/api/persona') return json(response, 200, await personaStore.save(await readJson(request)), headers);
    if (request.method === 'POST' && path === '/api/persona/rollback') {
      const body = await readJson(request);
      return json(response, 200, await personaStore.rollback(body.id), headers);
    }
    if (request.method === 'POST' && path === '/api/pairing-code') {
      const body = await readJson(request); const id = body.botId || 'bot-default';
      const bot = (await controlPlaneStore.get()).bots.find((item) => item.id === id);
      if (!bot) throw Object.assign(new Error('找不到这个 Bot'), { statusCode: 404 });
      return json(response, 200, pairing.create(id), headers);
    }
    if (request.method === 'GET' && path === '/api/session/status') {
      return json(response, 200, await manager.status(requiredChatId(url)), headers);
    }
    if (request.method === 'POST' && path.startsWith('/api/session/')) {
      const body = await readJson(request);
      const chatId = requiredBodyChatId(body);
      const targetBotId = body.botId ? String(body.botId) : 'bot-default';
      const action = path.slice('/api/session/'.length);
      if (action === 'new') return json(response, 200, await manager.newSession(chatId, targetBotId), headers);
      if (action === 'compact') return json(response, 200, await manager.compact(chatId, targetBotId), headers);
      if (action === 'stop') return json(response, 200, await manager.stop(chatId, targetBotId), headers);
    }
    throw Object.assign(new Error('接口不存在'), { statusCode: 404 });
  };
}

function resourceId(path, prefix) {
  if (!path.startsWith(prefix)) return null;
  const id = decodeURIComponent(path.slice(prefix.length));
  return id && !id.includes('/') ? id : null;
}

async function publicControlPlane(state, secretStore, telegramService, wechatService) {
  return {
    ...state,
    connections: await Promise.all(state.connections.map((item) => decorateConnection(item, secretStore))),
    bots: await Promise.all(state.bots.map((item) => decorateBot(item, secretStore, telegramService, wechatService, state))),
  };
}

async function decorateConnection(connection, secretStore) {
  const { env: _privateEnv, ...options } = connection.options ?? {};
  return { ...connection, options, hasSecret: await secretStore.has(`connection:${connection.id}`) };
}

async function decorateBot(bot, secretStore, telegramService, wechatService, state = null) {
  const controlPlane = state ?? { bots: [bot] };
  const channelType = bot.channel?.type ?? 'telegram';
  const runtime = channelType === 'wechat-clawbot'
    ? wechatService.status(controlPlane).bots.find((item) => item.botId === bot.id) ?? null
    : telegramService.status(controlPlane).bots.find((item) => item.botId === bot.id) ?? null;
  return { ...bot,
    hasTelegramToken: await secretStore.has(`telegram:${bot.id}`) || (bot.id === 'bot-default' && Boolean(process.env.TELEGRAM_BOT_TOKEN)),
    hasWechatAccount: await secretStore.has(`wechat:${bot.id}`), runtime };
}

async function reconcileChannels(telegramService, wechatService) {
  await Promise.all([telegramService.reconcile(), wechatService.reconcile()]);
}

function legacySettings(bot, connection) {
  const options = connection.options ?? {};
  return { engine: connection.kind, model: bot.chat.model, effort: bot.chat.effort,
    runtimeMode: options.runtimeMode === 'agent' ? 'agent' : 'chat', connectionId: connection.id,
    workingDirectory: options.workingDirectory ?? '', codex: { sandbox: options.sandbox ?? 'read-only', approvalPolicy: options.approvalPolicy ?? 'never' },
    claude: { tools: options.tools ?? [], allowedTools: options.allowedTools ?? [], disallowedTools: options.disallowedTools ?? [], mcpConfigPath: options.mcpConfigPath ?? '' },
    telegram: { enabled: bot.enabled, ...bot.telegram } };
}

async function assertSelection(settings, engines) {
  const capabilities = await engines.get(settings.engine).capabilities();
  if (!capabilities.available) throw Object.assign(new Error(capabilities.error || '所选引擎不可用'), { statusCode: 409 });
  if (settings.model) {
    const model = capabilities.models.find((item) => item.id === settings.model);
    if (!model) throw Object.assign(new Error(`模型不可用：${settings.model}`), { statusCode: 400 });
    const efforts = model.efforts?.length ? model.efforts : capabilities.efforts;
    if (settings.effort && !efforts.includes(settings.effort)) throw Object.assign(new Error(`该模型不支持档位：${settings.effort}`), { statusCode: 400 });
  } else if (settings.effort && !capabilities.efforts.includes(settings.effort)) {
    throw Object.assign(new Error(`所选引擎不支持档位：${settings.effort}`), { statusCode: 400 });
  }
}

async function assertConnectionSelection(settings, connection, engines) {
  const capability = await engines.capabilityFor(connection);
  if (!capability.available) throw Object.assign(new Error(capability.error || '连接不可用'), { statusCode: 409 });
  if (settings.model && !capability.supportsManualModel && !capability.models.some((item) => item.id === settings.model)) {
    throw Object.assign(new Error(`模型不可用：${settings.model}`), { statusCode: 400 });
  }
  const model = capability.models.find((item) => item.id === settings.model);
  const efforts = model?.efforts?.length ? model.efforts : capability.efforts;
  if (settings.effort && efforts.length && !efforts.includes(settings.effort)) {
    throw Object.assign(new Error(`档位不可用：${settings.effort}`), { statusCode: 400 });
  }
}

function requiredChatId(url) {
  const value = url.searchParams.get('chatId');
  if (!value) throw Object.assign(new Error('缺少 chatId'), { statusCode: 400 });
  return value;
}

function requiredBodyChatId(body) {
  const value = body.chatId;
  if (value === undefined || value === null || value === '') throw Object.assign(new Error('缺少 chatId'), { statusCode: 400 });
  return String(value);
}

function requiredBotId(body) {
  if (!body.botId) throw Object.assign(new Error('缺少 botId'), { statusCode: 400 });
  return String(body.botId);
}

function requiredQueryBotId(url) {
  const botId = url.searchParams.get('botId');
  if (!botId) throw Object.assign(new Error('缺少 botId'), { statusCode: 400 });
  return botId;
}
