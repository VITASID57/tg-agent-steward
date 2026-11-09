import { cloneDefaults } from './defaults.mjs';

const ENGINES = new Set(['codex', 'claude']);

function string(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : [];
}

export function normalizeSettings(input = {}) {
  const out = cloneDefaults();
  if (ENGINES.has(input.engine)) out.engine = input.engine;
  out.model = string(input.model);
  out.effort = string(input.effort);
  out.workingDirectory = string(input.workingDirectory);

  const codex = input.codex ?? {};
  if (['read-only', 'workspace-write'].includes(codex.sandbox)) out.codex.sandbox = codex.sandbox;
  if (['never', 'on-request', 'untrusted'].includes(codex.approvalPolicy)) out.codex.approvalPolicy = codex.approvalPolicy;

  const claude = input.claude ?? {};
  out.claude.tools = stringList(claude.tools);
  out.claude.allowedTools = stringList(claude.allowedTools);
  out.claude.disallowedTools = stringList(claude.disallowedTools);
  out.claude.mcpConfigPath = string(claude.mcpConfigPath);

  const tg = input.telegram ?? {};
  out.telegram.enabled = boolean(tg.enabled, out.telegram.enabled);
  out.telegram.allowedChatIds = stringList(Array.isArray(tg.allowedChatIds)
    ? tg.allowedChatIds.filter((item) => item !== null && item !== undefined).map(String)
    : []);
  for (const key of ['splitParagraphs', 'typingIndicator', 'longMessageSplit', 'mergeBurst', 'groupMode', 'reactions']) {
    out.telegram[key] = boolean(tg[key], out.telegram[key]);
  }
  if (Number.isInteger(tg.mergeDelayMs)) out.telegram.mergeDelayMs = Math.min(10_000, Math.max(0, tg.mergeDelayMs));

  const memory = input.memory ?? {};
  out.memory.enabled = boolean(memory.enabled, out.memory.enabled);
  if (Number.isFinite(memory.idleHours)) out.memory.idleHours = Math.min(168, Math.max(0, Number(memory.idleHours)));
  out.memory.endpoint = string(memory.endpoint);
  out.memory.awakeningTemplate = string(memory.awakeningTemplate);
  return out;
}
