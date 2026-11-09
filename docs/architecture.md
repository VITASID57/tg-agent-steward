# Architecture

```text
Telegram bot A ─ TelegramService / Runtime ─┐
WeChat bot B ─── WechatService / Runtime ───┼─ ConversationManager
Web / Town UI ──────────────────────────────┘          │
                             │                 prompt + memory + tool loop
                ControlPlaneStore                     │
        ┌────────────┬────────────┬────────────┬────────────┬─────────┐
   connections    persona      voice route  image route   memory / MCP
      presets     modules      + fallbacks  + fallbacks     adapters
        │                         │             │               │
  CLI / API / Vertex       TTS + STT      API / CLI      HTTP / stdio
```

## Ownership

- `ControlPlaneStore` owns references between reusable connections, profiles,
  voice profiles and Bots.
- `SecretStore` owns connection secrets and Telegram Tokens in a separate
  private file. Public state never contains secret text.
- `ConversationManager` owns per-Bot/per-chat session mappings, serialized
  turns and handoffs when a connection or persona revision changes.
- Engine adapters only implement model protocols. They do not import Telegram,
  voice providers or a private memory implementation.
- `TelegramService` reconciles any number of saved Bots; each has its own
  runtime and allowlist.
- `WechatService` owns QR-login state and reconciles WeChat ClawBot/iLink
  runtimes. `WechatRuntime` owns pairing, platform voice transcripts, message
  splitting and typing; `wechat-media.mjs` owns encrypted CDN image/file uploads.
  Account tokens and message context tokens never enter public state.
- `VoiceService` tries routes in order. Probability is decided before calling
  it, so an unselected turn does not spend TTS quota.
- `ImageService` applies the same ordered fallback contract to subscription
  CLIs, image APIs and ComfyUI workflows.
- `ToolBroker` discovers only selected MCP connections, caches catalogs for
  five minutes, enforces tool allowlists and keeps payment/final-order actions
  behind an explicit human `/tool` command.
- `WakeService` owns due checks and durable counters; Telegram remains the
  sender and the memory provider remains the briefing source.
- Memory providers implement `beforeReply` and `afterReply`; public core knows
  only a provider-neutral context/turn contract.

## Prompt and cache shape

The stable prompt order is: enabled non-empty persona modules, channel rules,
technical rules, then the selected tool catalog. Disabled modules are not sent
at all. Private-only modules and external memory are excluded in groups. Stable
modules stay at the front to give provider prompt caches the best chance to match. Handoff,
retrieved memory, sticker candidates and the current message are placed in the
user turn so changing per-turn context does not invalidate the stable system
prefix. CLI connection presets also select pure-chat isolation or full Agent
inheritance; see `runtime-modes.md`.

## Switching

Model or effort changes apply to the next provider request. A connection or
persona revision change first requests a short handoff from the old session,
then starts a new one with the new configuration.

## Private extensions

Private memory boards, deployment-specific tool names, MCP addresses, persona
text and custom Telegram behavior belong in a private adapter and runtime data
directory. They must not enter this public repository.
