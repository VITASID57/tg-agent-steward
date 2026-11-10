import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './api/api-handler.mjs';
import { cloneDefaults } from './config/defaults.mjs';
import { ControlPlaneStore } from './control/control-plane-store.mjs';
import { ConnectionTester } from './control/connection-tester.mjs';
import { ConversationManager } from './conversations/conversation-manager.mjs';
import { ApiSessionStore } from './engines/api/session-store.mjs';
import { HttpChatEngine } from './engines/api/http-chat-engine.mjs';
import { AppServerClient } from './engines/codex/app-server-client.mjs';
import { CodexEngine } from './engines/codex/codex-engine.mjs';
import { ClaudeEngine } from './engines/claude/claude-engine.mjs';
import { GrokEngine } from './engines/grok/grok-engine.mjs';
import { EngineRegistry } from './engines/engine-registry.mjs';
import { bearerAuth } from './http/auth.mjs';
import { startHttpServer } from './http/http-server.mjs';
import { staticFiles } from './http/static-files.mjs';
import { EMPTY_PERSONA_STATE, PersonaStore } from './persona/persona-store.mjs';
import { HttpMemoryProvider } from './memory/http-memory-provider.mjs';
import { ImageService } from './image/image-service.mjs';
import { JsonFile } from './storage/json-file.mjs';
import { RuntimeEventStore } from './runtime/runtime-event-store.mjs';
import { SettingsStore } from './storage/settings-store.mjs';
import { SecretStore } from './storage/secret-store.mjs';
import { StickerAssetStore } from './stickers/sticker-asset-store.mjs';
import { StickerService } from './stickers/sticker-service.mjs';
import { PairingService } from './telegram/pairing-service.mjs';
import { TelegramClient } from './telegram/telegram-client.mjs';
import { TelegramRuntime } from './telegram/telegram-runtime.mjs';
import { TelegramService } from './telegram/telegram-service.mjs';
import { ToolBroker } from './tools/tool-broker.mjs';
import { VoiceService } from './voice/voice-service.mjs';
import { TranscriptionService } from './voice/transcription-service.mjs';
import { WakeService } from './wake/wake-service.mjs';
import { WechatClient } from './wechat/wechat-client.mjs';
import { WechatRuntime } from './wechat/wechat-runtime.mjs';
import { WechatService } from './wechat/wechat-service.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.TG_STEWARD_DATA_DIR || join(root, 'data');
await mkdir(dataDir, { recursive: true });

const settingsStore = new SettingsStore(new JsonFile(join(dataDir, 'settings.json'), cloneDefaults()));
const controlPlaneStore = new ControlPlaneStore(new JsonFile(join(dataDir, 'control-plane.json'), {}), settingsStore);
const secretStore = new SecretStore(new JsonFile(join(dataDir, 'secrets.json'), { values: {} }));
const personaStore = new PersonaStore(new JsonFile(join(dataDir, 'persona.json'), EMPTY_PERSONA_STATE));
const stateFile = new JsonFile(join(dataDir, 'conversations.json'), { chats: {} });
const apiSessions = new ApiSessionStore(new JsonFile(join(dataDir, 'api-sessions.json'), { sessions: {} }));
const runtimeDir = join(dataDir, 'runtime');
const codexChatHome = join(runtimeDir, 'codex-home');
const codexChatWorkdir = join(runtimeDir, 'codex-workdir');
await prepareIsolatedCodex(codexChatHome, codexChatWorkdir);
const codexAgentClient = new AppServerClient();
const codexChatClient = new AppServerClient({ env: { ...process.env, CODEX_HOME: codexChatHome }, cwd: codexChatWorkdir });
const engines = new EngineRegistry([
  new CodexEngine({ chat: codexChatClient, agent: codexAgentClient }, { chatWorkdir: codexChatWorkdir }),
  new ClaudeEngine({ runtimeRoot: join(runtimeDir, 'claude') }),
  new GrokEngine({ runtimeRoot: join(runtimeDir, 'grok') }),
], { secretStore, apiSessions, apiEngineFactory: (options) => new HttpChatEngine(options) });
const memoryProvider = new HttpMemoryProvider({ controlPlaneStore, secretStore });
const toolBroker = new ToolBroker({ controlPlaneStore, secretStore });
const eventStore = new RuntimeEventStore(new JsonFile(join(dataDir, 'runtime-events.json'), { bots: {} }));
const connectionTester = new ConnectionTester({ controlPlaneStore, secretStore, engines, toolBroker });
const stickerAssetStore = new StickerAssetStore(join(dataDir, 'sticker-assets'));
const stickerService = new StickerService({ controlPlaneStore, assetStore: stickerAssetStore });
const manager = new ConversationManager({ settingsStore, personaStore, controlPlaneStore, stateFile, engines, memoryProvider, toolBroker, stickerService });
const pairing = new PairingService(controlPlaneStore, secretStore);
const voiceService = new VoiceService({ controlPlaneStore, secretStore });
const transcriptionService = new TranscriptionService({ controlPlaneStore, secretStore });
const imageService = new ImageService({ controlPlaneStore, secretStore });
const telegramService = new TelegramService({
  envToken: process.env.TELEGRAM_BOT_TOKEN, controlPlaneStore, secretStore, eventStore,
  checkToken: (token) => new TelegramClient(token).getMe(AbortSignal.timeout(8_000)),
  createRuntime: (botId, token) => new TelegramRuntime({
    botId, client: new TelegramClient(token), controlPlaneStore, manager, pairing, engines, voiceService,
    transcriptionService, imageService, stickerService, toolBroker, eventStore,
  }),
});
const wechatStateFile = new JsonFile(join(dataDir, 'wechat-state.json'), { bots: {} });
const wechatService = new WechatService({
  controlPlaneStore, secretStore, stateFile: wechatStateFile, eventStore,
  createRuntime: (botId, account, onStatus) => new WechatRuntime({
    botId, client: new WechatClient(account), controlPlaneStore, manager, stateFile: wechatStateFile,
    pairing, voiceService, stickerService, eventStore, onStatus,
  }),
});
const wakeService = new WakeService({ controlPlaneStore,
  stateFile: new JsonFile(join(dataDir, 'wake-state.json'), { bots: {} }),
  eventStore,
  send: (botId, targetId, prompt, context) => context.channel === 'wechat-clawbot'
    ? wechatService.proactive(botId, targetId, prompt, context)
    : telegramService.proactive(botId, targetId, prompt, context),
});
const services = { settingsStore, personaStore, controlPlaneStore, secretStore, manager, engines, pairing,
  telegramService, wechatService, imageService, stickerAssetStore, toolBroker, wakeService, eventStore, connectionTester };

const host = process.env.TG_STEWARD_HOST || '127.0.0.1';
const port = Number(process.env.TG_STEWARD_PORT || process.env.PORT || 8788);
const authMode = String(process.env.TG_STEWARD_AUTH_MODE || 'password').trim().toLowerCase();
if (!['password', 'none'].includes(authMode)) throw new Error('TG_STEWARD_AUTH_MODE 只支持 password 或 none');
if (authMode === 'none' && !isLoopback(host)) throw new Error('免密码模式只能绑定 127.0.0.1、localhost 或 ::1');
const adminToken = authMode === 'none' ? '' : await loadAdminToken(join(dataDir, '.admin-token'));
const allowedOrigins = new Set((process.env.TG_STEWARD_ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean));
allowedOrigins.add(`http://${host}:${port}`);
allowedOrigins.add(`http://localhost:${port}`);

const server = await startHttpServer({
  host, port, allowedOrigins, authRequired: authMode !== 'none',
  authenticate: authMode === 'none' ? () => {} : bearerAuth(adminToken),
  apiHandler: createApiHandler(services), serveStatic: staticFiles(join(root, 'src', 'web')),
});

const telegramState = await telegramService.reconcile();
const wechatState = await wechatService.reconcile();
wakeService.start();
for (const bot of telegramState.bots) if (bot.lastError) console.error(`Telegram ${bot.name} 启动失败：${bot.lastError}`);
for (const bot of wechatState.bots) if (bot.lastError) console.error(`WeChat ${bot.name} 启动失败：${bot.lastError}`);

console.log(`TG Agent Steward: http://${host}:${port}`);
console.log(authMode === 'none' ? '管理密码：已关闭（仅限本机）' : `管理密码文件：${join(dataDir, '.admin-token')}`);
if (!telegramState.bots.some((bot) => bot.configured)) console.log('尚未保存 Telegram Bot Token；控制页可用，Bot 暂未启动。');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    telegramService.stop();
    wechatService.stop();
    wakeService.stop();
    server.close();
    await Promise.all([codexAgentClient.close(), codexChatClient.close()]);
    process.exit(0);
  });
}

async function loadAdminToken(path) {
  if (process.env.TG_STEWARD_ADMIN_PASSWORD) return process.env.TG_STEWARD_ADMIN_PASSWORD;
  if (process.env.TG_STEWARD_ADMIN_TOKEN) return process.env.TG_STEWARD_ADMIN_TOKEN;
  try { return (await readFile(path, 'utf8')).trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const token = randomBytes(32).toString('base64url');
    await writeFile(path, `${token}\n`, { mode: 0o600 });
    return token;
  }
}

function isLoopback(host) { return ['127.0.0.1', 'localhost', '::1'].includes(String(host).toLowerCase()); }

async function prepareIsolatedCodex(home, workdir) {
  await Promise.all([mkdir(home, { recursive: true }), mkdir(workdir, { recursive: true })]);
  const source = join(homedir(), '.codex', 'auth.json'); const target = join(home, 'auth.json');
  try {
    const [sourceStat, targetStat] = await Promise.all([stat(source), stat(target).catch(() => null)]);
    if (!targetStat || sourceStat.mtimeMs > targetStat.mtimeMs) await copyFile(source, target);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
