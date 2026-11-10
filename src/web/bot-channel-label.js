export function extraChannelLabel(bot) {
  const name = bot.name || '';
  if (bot.channel?.type === 'wechat-clawbot') return /微信|wechat/iu.test(name) ? '' : '微信';
  return /\btelegram\b/iu.test(name) ? '' : 'Telegram';
}
