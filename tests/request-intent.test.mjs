import assert from 'node:assert/strict';
import test from 'node:test';
import { imageRequestPrompt, isExplicitVoiceRequest, voiceRequestText } from '../src/media/request-intent.mjs';

test('direct natural-language image requests are routed without treating status questions as draws', () => {
  assert.equal(imageRequestPrompt('老公给我画张图，随便画啥'), '老公给我画张图，随便画啥');
  assert.equal(imageRequestPrompt('测试画画 随便画啥✌️'), '测试画画 随便画啥✌️');
  assert.equal(imageRequestPrompt('/draw 蓝色龙胆花'), '蓝色龙胆花');
  assert.equal(imageRequestPrompt('那老公再画个画看看'), '那老公再画个画看看');
  assert.equal(imageRequestPrompt('好啦～老公画一张有树的图。'), '好啦～老公画一张有树的图。');
  assert.equal(imageRequestPrompt('为什么生图功能没有工作？'), null);
  assert.equal(imageRequestPrompt('没看到图'), null);
  assert.equal(imageRequestPrompt('老公贝～测试画图'), '老公贝～测试画图');
  assert.equal(imageRequestPrompt('语音有的～老公你用Google Vertex线路生图呢？'), '语音有的～老公你用Google Vertex线路生图呢？');
});

test('an explicit voice request bypasses only the random voice gate', () => {
  assert.equal(isExplicitVoiceRequest('老公给我发语音看看'), true);
  assert.equal(isExplicitVoiceRequest('用语音念给我听'), true);
  assert.equal(isExplicitVoiceRequest('今天随便聊聊'), false);
  assert.equal(isExplicitVoiceRequest('喵喵～再试试语音🥰'), true);
  assert.equal(isExplicitVoiceRequest('语音失败～再说一句看看'), true);
  assert.equal(isExplicitVoiceRequest('语音有的～老公你用Google Vertex线路生图呢？'), false);
  assert.equal(isExplicitVoiceRequest('/voice'), true);
  assert.equal(voiceRequestText('/voice 念个晚安'), '念个晚安');
});
