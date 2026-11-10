export function mediaToolBlocked(bot, name) {
  const words = String(name).replace(/([a-z])([A-Z])/gu, '$1_$2').toLowerCase().split(/[^a-z0-9]+/u);
  const image = words.includes('image') && words.some((word) => ['generate', 'draw', 'create', 'render'].includes(word));
  const audio = String(name).toLowerCase() === 'tts' || (words.some((word) => ['tts', 'voice', 'speech', 'audio'].includes(word))
    && words.some((word) => ['generate', 'synthesize', 'synthesise', 'speak'].includes(word)));
  return (image && (bot.channel?.type === 'wechat-clawbot' || (bot.image?.enabled && bot.image.imageProfileId)))
    || (audio && bot.voice?.enabled && bot.voice.voiceProfileId);
}

export function mediaGuide(bot) {
  if (!bot) return '';
  const rules = [];
  if (bot.voice?.enabled && bot.voice.voiceProfileId) {
    rules.push('语音由栖光庭按本 Bot 的声音预设合成并发送。写出你要说的正文即可，无需调用其他合成工具。发送结果由栖光庭反馈。');
  }
  if (bot.channel?.type === 'wechat-clawbot') {
    rules.push('当前微信 Bot 暂未开放生图。收到绘图请求时如实说明，不生成图片或调用外部生图工具。');
  } else if (bot.image?.enabled && bot.image.imageProfileId) {
    rules.push('画图由栖光庭的生图预设处理。可请用户发送 /draw 加画面描述，无需调用其他生图工具。');
  }
  return rules.join('\n');
}
