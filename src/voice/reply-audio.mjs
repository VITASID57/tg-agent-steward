import { shouldSendVoice } from './probability.mjs';

export async function deliverReplyAudio({ voice, voiceService, text, explicit, random, send, signal }) {
  if (!voice?.enabled || !voice.voiceProfileId) {
    return { sent: false, stage: '声音预设', error: explicit ? new Error('这个 Bot 还没有启用语音或选择声音预设') : null };
  }
  if (!explicit && !shouldSendVoice(voice, random)) return { sent: false, error: null };
  if (!text?.trim()) return { sent: false, stage: '正文准备', error: explicit ? new Error('本轮没有可朗读的正文') : null };
  let stage = '合成';
  try {
    const audio = await voiceService.synthesize(voice.voiceProfileId, text, signal);
    stage = '上传';
    await send(audio);
    return { sent: true, error: null };
  } catch (error) {
    signal?.throwIfAborted();
    return { sent: false, error, stage };
  }
}
