# External memory HTTP contract

Create a `memory-http` connection with the adapter base URL, save its optional
Bearer secret, then assign the connection to a Bot.

## Read context

Default request: `POST /v1/context`

```json
{
  "actor": "bot-default",
  "botId": "bot-default",
  "chatId": "12345",
  "mode": "awakening",
  "query": "current user message",
  "limitTokens": 2500
}
```

`mode` is `awakening` when no prior turn exists or the configured idle period
has elapsed; otherwise it is `continuity`. The adapter may return any one of:

```json
{ "contextText": "small, relevant context" }
```

`text` and `briefing` are also accepted aliases. Empty context is valid.

## Write turn

Default request: `POST /v1/turns`

```json
{
  "actor": "bot-default",
  "botId": "bot-default",
  "chatId": "12345",
  "userText": "hello",
  "assistantText": "hi",
  "surface": "telegram"
}
```

Options on the connection can override `contextPath`, `writePath`, `actor`,
`idleHours`, `limitTokens`, `timeoutMs`, and `writeEnabled`. Automatic write is
off by default and must be enabled only after confirming that the target accepts
whole conversation turns. Read/write failure
is logged but does not prevent the Telegram reply. Group messages skip both
operations by design.

A private memory bridge can translate these two calls into its own
`get_briefing`, search, evidence and write tools without exposing those details
to the public core.
