export function assembleInstructions({ persona, profile, settings, handoff = '', memory = '', context = {} }) {
  const surface = context.surface || settings.channel || 'telegram';
  const profileText = profile?.blocks?.filter((block) => block.enabled && block.body?.trim()
      && (block.scope === 'all' || context.group !== true)
      && (!block.surface || block.surface === 'all' || block.surface === surface))
    .map((block) => `【${block.title || '人物设定'}】\n${block.body.trim()}`).join('\n\n');
  return [
    profileText,
    context.voiceGuide ? `【语音表现】\n${context.voiceGuide}` : '',
  ].filter(Boolean).join('\n\n');
}

export function assembleTurnPrompt({ message, handoff = '', memory = '', stickerInstructions = '' }) {
  return [
    handoff ? `【上一会话交接】\n${handoff}` : '',
    memory ? `【外置记忆提供的相关上下文】\n${memory}` : '',
    stickerInstructions,
    `【对方的消息】\n${message}`,
  ].filter(Boolean).join('\n\n');
}
