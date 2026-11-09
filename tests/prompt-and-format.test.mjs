import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleInstructions, assembleTurnPrompt } from '../src/prompt/assemble.mjs';
import { splitTelegramMessage } from '../src/telegram/message-format.mjs';

const settings = { telegram: { splitParagraphs: true, groupMode: false } };

test('stable prompt contains only explicitly enabled profile modules', () => {
  const value = assembleInstructions({ persona: { text: '旧人物正文' }, profile: { blocks: [
    { title: '人物', body: '人物正文', enabled: true, scope: 'all', surface: 'all' },
    { title: '关闭规则', body: '不应出现', enabled: false, scope: 'all', surface: 'all' },
  ] }, settings });
  assert.equal(value, '【人物】\n人物正文');
  assert.doesNotMatch(value, /旧人物正文|Telegram 场景规则|技术规则|不应出现/u);
  assert.doesNotMatch(value, /上一会话交接/);
  const turn = assembleTurnPrompt({ message: '你好', handoff: '交接内容', memory: '记忆内容' });
  assert.match(turn, /【上一会话交接】\n交接内容/);
  assert.match(turn, /【外置记忆提供的相关上下文】\n记忆内容/);
});

test('empty persona modules are skipped instead of injecting empty headings', () => {
  const value = assembleInstructions({ persona: { text: '' }, profile: { blocks: [
    { title: '基础人格', body: '   ', enabled: true, scope: 'all' },
    { title: '关系', body: '是恋人', enabled: true, scope: 'all' },
  ] }, settings });
  assert.doesNotMatch(value, /【基础人格】/);
  assert.match(value, /【关系】\n是恋人/);
});

test('profile modules can target Telegram, WeChat, or private chats without forced channel text', () => {
  const profile = { blocks: [
    { title: '通用', body: '全部渠道', enabled: true, scope: 'all', surface: 'all' },
    { title: 'TG', body: '只给 TG', enabled: true, scope: 'all', surface: 'telegram' },
    { title: 'WX', body: '只给微信', enabled: true, scope: 'all', surface: 'wechat' },
    { title: '私聊', body: '只给私聊', enabled: true, scope: 'private', surface: 'all' },
  ] };
  const telegram = assembleInstructions({ profile, settings, context: { surface: 'telegram', group: true } });
  assert.match(telegram, /全部渠道|只给 TG/u); assert.doesNotMatch(telegram, /只给微信|只给私聊/u);
  const wechat = assembleInstructions({ profile, settings, context: { surface: 'wechat', group: false } });
  assert.match(wechat, /全部渠道|只给微信|只给私聊/u); assert.doesNotMatch(wechat, /只给 TG/u);
  assert.equal(assembleInstructions({ profile: { blocks: [] }, settings, context: { surface: 'wechat' } }), '');
});

test('Telegram formatter splits paragraphs and oversized messages', () => {
  assert.deepEqual(splitTelegramMessage('第一段\n\n第二段', { splitParagraphs: true, longMessageSplit: true }), ['第一段', '第二段']);
  const chunks = splitTelegramMessage('字'.repeat(8000), { splitParagraphs: false, longMessageSplit: true });
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 3900));
});
