import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSendVoice } from '../src/voice/probability.mjs';

test('voice probability has real zero, hundred, and deterministic middle gates', () => {
  assert.equal(shouldSendVoice({ enabled: true, replyProbability: 0 }, () => 0), false);
  assert.equal(shouldSendVoice({ enabled: true, replyProbability: 100 }, () => 0.99999), true);
  assert.equal(shouldSendVoice({ enabled: false, replyProbability: 100 }, () => 0), false);
  assert.equal(shouldSendVoice({ enabled: true, replyProbability: 30 }, () => 0.299), true);
  assert.equal(shouldSendVoice({ enabled: true, replyProbability: 30 }, () => 0.3), false);
});
