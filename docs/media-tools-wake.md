# Media, MCP and wake setup

## Image routing

Create each provider once under **Connection presets**, then create an **Image
route** whose first item is preferred and remaining items are fallbacks. A Bot
only stores the image-route ID.

- **Codex / Grok Build subscription**: install and log in to the official CLI
  on the same machine. The steward uses an isolated temporary directory,
  removes API-key-like environment variables from the child process, accepts
  one generated PNG/JPEG/WebP and removes temporary output afterwards.
- **OpenAI-compatible relay**: set the base URL and secret. The steward calls
  `/v1/images/generations` and accepts base64 or URL output.
- **Vertex / Gemini image API**: set the model and choose `api-key` or Bearer
  authentication in connection options.
- **NovelAI**: use the official image endpoint or a compatible endpoint. The
  direct response may be an image or a ZIP containing an image.
- **ComfyUI**: put `workflow`, `promptNodeId`, optional `promptInputKey`, and
  optional `outputNodeId` in route-options JSON. The steward queues `/prompt`,
  polls `/history/:id`, then downloads `/view`.

Current `/draw` is text-to-image. Reference-image editing is deliberately not
advertised yet.

## Voice

Output voice profiles can use MiniMax, ElevenLabs, GPT-SoVITS, Vertex/Gemini
TTS and local Edge TTS with ordered fallback. The probability slider is applied
before synthesis, so a missed turn spends no TTS quota.

Incoming Telegram voice/audio can use ElevenLabs Scribe, an OpenAI-compatible
`/v1/audio/transcriptions` endpoint, Vertex/Gemini inline audio, or a local
Whisper command. Select the transcription connection on the Bot page.

## MCP connections

Remote MCP supports Streamable HTTP JSON/SSE. Keep the base URL and secret in
separate fields; choose Bearer, custom header, or query-parameter placement.
Local desktop services use `mcp-stdio`: command, one argument per line, and an
optional environment-variable name that receives the separately stored secret.

Useful official examples:

| Service | Steward shape | Notes |
| --- | --- | --- |
| [Amap](https://developer.amap.com/api/mcp-server/summary) | remote; `https://mcp.amap.com/mcp`; query `key` | Web Service key; Streamable HTTP |
| [Baidu Map](https://lbs.baidu.com/docs/ai?title=mcpserver%2Fbase) | remote; `https://mcp.map.baidu.com/mcp`; query `ak` | also documents SSE/stdio |
| [Tencent Map](https://lbs.qq.com/service/MCPServer/MCPServerGuide/overview) | remote; `https://mcp.map.qq.com/mcp?format=0`; query `key` | WebService quota applies |
| [Didi](https://mcp.didichuxing.com) | remote after service activation | Pro/enterprise capabilities differ |
| [Meituan](https://developer.meituan.com/ai-hub/mcp-list) | use the selected catalog service | not one universal URL |
| [Taobao desktop Skill](https://tblifecdn.taobao.com/taobaopc/skills/taobao-native/SKILL.md) | local stdio / desktop login | a Skill is instructions; it is not a remote MCP URL |
| [McDonald's China](https://open.mcd.cn/mcp/doc) | follow account documentation | ordering is a write action |
| [Luckin](https://open.lkcoffee.com/docs) | follow MCP/CLI documentation | order creation/payment link are writes |
| [FlyPig Skill](https://github.com/alibaba-flyai/flyai-skill) | install the Skill's declared runtime | inspect permissions before enabling |
| [Tongcheng Business Travel](https://tmc.ly.com/zh/resources/updates/open-mcp-skills-cli) | enterprise MCP/Skill/CLI | enterprise activation may be required |

The `/tools` command lists the Bot's permitted catalog. `/tool name {json}` is
an explicit human call. Read-only tools can run automatically if selected;
unmarked write tools need the Bot's write switch, and payment/checkout/final
order operations still require a human `/tool` command.

Do not paste API keys into URL fields, workflow JSON, command arguments or
Skill text. Use the secret field and its placement settings.

## Automatic wake

Wake is a client-side executor, not a second memory database. On each due run
it asks the normal conversation pipeline, so the selected memory adapter can
provide an `awakening` briefing before the model decides whether to speak.
HTTP memory adapters can set context/write paths; remote MCP memory adapters
can instead set their briefing and write tool names. Automatic writes remain
off until explicitly enabled.

The scheduler persists the next attempt, last attempt, last successful send,
daily count and result. A Bot can use a fixed interval or a random minimum and
maximum. Random mode samples again after every due check, including a due time
that lands inside quiet hours, so it does not settle into one daily minute.
Cooldown and daily limits still apply. Returning exactly `[[SILENT]]` records a
silent wake without sending a message or consuming the daily message count.

The Bot detail page exposes this persisted state as a compact status panel:
schedule mode, next attempt, latest result, and today's successful-send count.
Sent, silent, and failed wake runs also enter the per-Bot runtime timeline.
The timeline stores operational metadata only and never stores chat text.

Wake is off by default and the target must already be in that Bot's allowlist.
Telegram sends to the configured Chat ID. WeChat sends with the target user's
most recently saved conversation context; that user must have spoken to the Bot
first. If Tencent rejects an expired context, the run is stored as failed and
does not consume the successful-send quota.
