import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSpeechText, speakNumbersInChinese, stripVoiceTags, voiceTagGuide } from '../src/voice/speech-text.mjs';

test('Chinese dates, time, money and percentages become natural speech text', () => {
  const spoken = speakNumbersInChinese('日期是2026-06-18，时间08:05，价格￥39.9，进度12.5%。');
  assert.equal(spoken, '日期是二零二六年六月十八日，时间八点零五分，价格三十九点九元，进度百分之十二点五。');
});

test('voice tags stay only on providers that support them', () => {
  const eleven = prepareSpeechText('[whispers] 你好 [unknown mood]', { kind: 'elevenlabs' }, { model: 'eleven_v3' });
  assert.equal(eleven, '[whispers] 你好');
  const elevenV4 = prepareSpeechText('[curious] 你好 [light rain]', { kind: 'elevenlabs' }, { model: 'eleven_v4' });
  assert.equal(elevenV4, '[curious] 你好');
  const edge = prepareSpeechText('[sighs] 你好', { kind: 'edge-tts' }, {});
  assert.equal(edge, '你好');
  const gemini = prepareSpeechText('[laughs] 你好', { kind: 'vertex-ai' }, {});
  assert.equal(gemini, '[laughing] 你好');
  assert.equal(stripVoiceTags('[softly] 你好。'), '你好。');
  assert.equal(stripVoiceTags('参考 [OpenAI] 文档'), '参考 [OpenAI] 文档');
  assert.match(voiceTagGuide({ kind: 'elevenlabs' }), /\[excited\]/u);
  assert.match(voiceTagGuide({ kind: 'elevenlabs' }, { model: 'eleven_v4' }), /\[curious\]/u);
  assert.doesNotMatch(voiceTagGuide({ kind: 'vertex-ai' }), /\[excited\]/u);
});
