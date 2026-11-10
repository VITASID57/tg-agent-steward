# Chat isolation and Agent mode

CLI chat connections expose two runtime modes. The choice belongs to a reusable
connection preset, so every Bot assigned to that preset gets the same isolation
boundary.

## Pure chat (default)

Pure chat keeps the model provider's non-removable platform behavior, then adds
only the steward's enabled non-empty persona modules for the current channel,
selected memory context and explicitly allowed feature protocols or tools. It does not promise that a model is
literally running with no system instructions.

| Engine | What the steward isolates | Known remainder |
| --- | --- | --- |
| Codex | Dedicated `CODEX_HOME`, copied local login token, empty working directory, no Desktop or repository `AGENTS.md` discovery | Codex platform/developer behavior remains |
| Claude Code | Replaces the default system prompt, disables CLAUDE.md and auto-memory discovery, loads project settings from the empty runtime directory, and limits native MCP to an explicitly supplied config | Model/platform behavior and managed organization policy remain. The Bot's MCP switches apply to steward tools; native MCP has separate CLI permission rules |
| Grok Build | Dedicated `GROK_HOME`, copied local login token, empty working directory, no memory/subagents/web/ask-user and an explicit built-in-tool deny list | Installed Grok skill summaries and environment metadata may still appear |

The copied login files stay under the private data directory and are never
returned by the control API. If a provider refreshes its login, restart the
steward so the isolated home receives the current local login file.

## Full Agent

Full Agent intentionally uses the normal CLI home and the configured working
directory. Project rules, user settings, Skills, plugins, MCP configuration and
native tools may therefore enter the model context. The persona is appended to
that environment instead of being treated as the whole runtime.

Use this mode only when a Bot is expected to read files or perform coding/agent
work. It is not the default for companion chat.

## Prompt and cache boundary

The stable prefix contains only enabled non-empty persona modules that match the
current channel, plus the selected tool catalog when tools are enabled. There is
no hidden steward personality, channel rule, or technical response rule. Per-turn memory,
handoff summaries, sticker candidates and the user's current message are sent as
the user turn. This avoids changing the system prefix on every message and gives
provider prompt caches a stable prefix to reuse.

The Bot page preview shows the content assembled by the steward and estimated
tokens. It cannot reveal or remove hidden provider instructions, so the UI names
that section "steward injection" instead of claiming it is the model's entire
input.
