export const DEFAULT_SETTINGS = Object.freeze({
  engine: 'codex',
  model: '',
  effort: '',
  workingDirectory: '',
  codex: {
    sandbox: 'read-only',
    approvalPolicy: 'never',
  },
  claude: {
    tools: [],
    allowedTools: [],
    disallowedTools: [],
    mcpConfigPath: '',
  },
  telegram: {
    enabled: true,
    allowedChatIds: [],
    splitParagraphs: true,
    typingIndicator: true,
    longMessageSplit: true,
    mergeBurst: true,
    mergeDelayMs: 1800,
    groupMode: false,
    reactions: false,
  },
  memory: {
    enabled: false,
    idleHours: 8,
    endpoint: '',
    awakeningTemplate: '',
  },
});

export function cloneDefaults() {
  return structuredClone(DEFAULT_SETTINGS);
}
