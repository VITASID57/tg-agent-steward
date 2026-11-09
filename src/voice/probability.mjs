export function shouldSendVoice({ enabled, replyProbability, probability }, random = Math.random) {
  const chance = Number(replyProbability ?? probability ?? 0);
  if (!enabled || chance <= 0) return false;
  if (chance >= 100) return true;
  return random() * 100 < chance;
}
