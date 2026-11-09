# Validation status

Last checked: 2026-11-09.

## Passed in this workspace

- Gentiana theme: empty-token feedback, authenticated login with URL-fragment
  cleanup, all seven sections at 375/390/768/1024/1440 px, and reduced-motion
  pause checked in a real browser. No document-width overflow in these views.
- Windows launcher started the local service and validated its stored admin
  token without printing it. No Telegram credentials were configured.
- `npm run check`: 77/77 offline tests.
- Voice probability: boundary test plus Telegram-runtime test proving a missed
  gate does not call TTS and a hit does send the generated audio.
- Voice fallback: first provider failure proceeds to the next route.
- Speech preparation: Chinese dates/time/money/percent normalization and
  provider-aware voice-tag preservation/stripping.
- Sticker packs: probability and explicit-request gates, decline detection,
  recent-item penalty, candidate-ID revalidation, image magic-byte checks and
  path traversal rejection.
- Vertex TTS: raw 24 kHz PCM is wrapped as a valid RIFF/WAV payload.
- OpenAI-compatible and Vertex chat request shape, selected model, effort and
  authentication header verified with fake transports.
- Multi-Bot reconciliation, secret redaction, external memory read/write and
  group privacy filtering verified with fake transports.
- HTTP smoke: health endpoint, schema v2 CRUD and secret-redacted public state.
- New v0.3 control page returned 200, all JavaScript DOM references resolved,
  and connection → image route → Bot assignment persisted through the real
  local HTTP API. Playwright snapshots plus desktop and 390 px screenshots
  verified the Bot and image-route pages were nonblank, readable and usable;
  narrow navigation scrolls horizontally by design.
- Real local Grok Build subscription smoke: authenticated ACP turn returned the
  exact requested `SMOKE_OK` and a resumable session identifier.
- Codex/Grok subscription image command shape comes from a previously real-smoked
  Mimi Town bridge; this repository's tests use a fake process runner and did
  not spend subscription quota.

## Bot card UI acceptance

2026-11-09 runtime-visibility follow-up: connection presets now have a no-generation
self-check with persisted passed/warning/failed results. Per-Bot diagnostics expose
automatic-wake scheduling and a privacy-filtered 80-event runtime timeline. Offline
tests cover live/config-only/failing connection checks, MCP discovery, event redaction,
deduplication/removal, and wake status without target-ID disclosure. Real Chrome at
390x844 confirmed the new status surface is readable with zero document-width overflow;
the Codex CLI self-check returned its live model catalog and no paid model turn was sent.

2026-11-09 model-catalog and detail-layout follow-up: a fresh temporary data
directory exposed only “新建连接”, with no provider-specific presets. Real browser
checks at 390x844 verified chat, MiniMax voice and image model dropdowns using
saved or built-in catalogs, four content-module counts on one row, the complete
wide gentian banner and zero document-width overflow. The Bot status page now
uses one primary surface with separators instead of nested cards; its full mobile
height was 2239 px with empty usage data. The generated banner was inspected at
1600x670 before its optimized WebP was wired into the responsive picture source.

2026-11-09 persistent browser login: a real Chrome context logged in once,
closed the page, opened a new page and entered the steward automatically from
localStorage. The same check confirmed sessionStorage is no longer used and the
explicit “forget this device” action clears the saved credential and returns to
the login screen.

2026-11-09 mobile visual polish: the responsive botanical panel uses a generated
landscape gentian asset at 850 px and below while the desktop sidebar keeps the
portrait specimen. The Bot directory renders a compact two-column grid at phone
width, fitting four 213 px cards in two rows. Chrome checks at 390x844,
844x390 and 1440x1000 found no document-width overflow; sticker field spacing
is 20 px, and reduced-motion disables the flower animation.

2026-11-09 LAN login fix: browser requests opened through loopback or a local
network IP are accepted when their Origin matches the request Host, while
unrelated cross-site origins remain blocked. A real Chrome run verified the
stored management password, password reveal button and complete login flow at
both `127.0.0.1` and the active LAN address.

2026-11-09 prompt and usage follow-up: stable instructions contain only enabled,
non-empty profile modules matching the active channel, plus feature protocols
for explicitly enabled tools or expressive voice. Optional Telegram, WeChat,
general-chat and tool-writing templates stay disabled until the user enables
and saves them. Telegram typing, paragraph splitting, long-message splitting
and burst merging are independently persisted and consumed by the runtime.
Playwright verified two live quota bars, KPI cards, a one-year token heatmap,
all four Telegram switches, opt-in templates, no browser console errors and no
document-width overflow at 390 px. Screenshots are stored under the ignored
`output/playwright/` directory.

2026-11-08 UI follow-up: 43 offline tests pass, including avatar persistence,
older-client preservation, removal, and unsafe/oversized image rejection.
Isolated local Playwright checks with two disabled, token-free Bots verified
card selection, draft restoration, new-Bot selection after saving, nine section
toggles, invalid-field reopening, closed-section probability persistence (73%),
avatar upload and reload, shared-persona usage, and conditional API-format help.
375px and 1440px layouts were inspected; the 375px expanded form had no horizontal
overflow. Screenshots and fake data remain in the ignored `.playwright-cli/`.
No paid model or Telegram calls were made for these checks.

2026-11-08 brand and voice follow-up: the control surface is named 栖光庭 /
Lumenkeep while the repository keeps its descriptive name. Bot cards now use a
2:3 image window and the bundled full gentian artwork when no upload exists.
The voice editor exposes provider-aware expression support. The provider-neutral
Dockerfile was syntax-reviewed, but a container build was not run because Docker
is not installed on the development machine.

2026-11-08 provider/auth follow-up: ElevenLabs official documentation was
rechecked after the v4 release. Blank ElevenLabs routes now use `eleven_v4`;
v4, v4 Turbo and v3 expose provider-aware expression tags. Custom management
passwords, legacy token compatibility and local-only password-free mode were
smoked through HTTP and a real browser. Password-free startup was also verified
to refuse `0.0.0.0`.

## Still requires deployment-specific acceptance

- A real Telegram Bot Token, polling, pairing and outbound voice upload.
- Each user's image, TTS, STT, memory and MCP credentials or local services.
- Official-service account activation, OAuth/login and any order/payment flow.
- Any private memory adapter and downstream host-product plugin package.

Provider presence or a model catalog is not treated as proof of a successful
request. These items stay pending until their real route is exercised.
