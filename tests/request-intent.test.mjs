import assert from 'node:assert/strict';
import test from 'node:test';
import { imageRequestPrompt, isExplicitVoiceRequest } from '../src/media/request-intent.mjs';

test('direct natural-language image requests are routed without treating status questions as draws', () => {
  assert.equal(imageRequestPrompt('老公给我画张图，随便画啥'), '老公给我画张图，随便画啥');
  assert.equal(imageRequestPrompt('测试画画 随便画啥✌️'), '测试画画 随便画啥✌️');
  assert.equal(imageRequestPrompt('/draw 蓝色龙胆花'), '蓝色龙胆花');
  assert.equal(imageRequestPrompt('为什么生图功能没有工作？'), null);
  assert.equal(imageRequestPrompt('没看到图'), null);
});

test('an explicit voice request bypasses only the random voice gate', () => {
  assert.equal(isExplicitVoiceRequest('老公给我发语音看看'), true);
  assert.equal(isExplicitVoiceRequest('用语音念给我听'), true);
  assert.equal(isExplicitVoiceRequest('今天随便聊聊'), false);
});
