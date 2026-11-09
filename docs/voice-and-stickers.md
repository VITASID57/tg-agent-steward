# Voice expression and sticker packs

## Voice text preparation

The normal Telegram voice-message path synthesizes one complete reply, so it
does not need a realtime-call playback queue, VAD, barge-in or echo
cancellation. Before TTS, the steward instead performs the parts that improve
ordinary voice messages:

- Chinese dates, times, currency, percentages, fractions and decimals are
  converted into speech-friendly text.
- Emoji and lightweight Markdown are removed from spoken text.
- ElevenLabs `eleven_v4`, `eleven_v4_turbo` and `eleven_v3` keep a controlled
  list of audio tags. A blank ElevenLabs model uses `eleven_v4`.
- Vertex/Gemini maps that allowlist to supported style hints.
- Other providers strip all bracketed voice tags.

The model receives the tag guide only when the selected primary TTS route
supports it. Tags are removed from the visible Telegram text and memory write;
the original tagged reply exists only long enough for synthesis.

The voice editor shows this distinction on every route. Vertex/Gemini TTS and
ElevenLabs v4, v4 Turbo and v3 routes are labeled as supporting autonomous
expression. MiniMax, GPT-SoVITS, Edge TTS and other ElevenLabs models currently
provide voice/timbre synthesis; unsupported tags are stripped. The current
generic control plane does not expose speed, pitch or emotion sliders.

## Sticker packs

Create a pack under **Sticker packs**, upload PNG/JPEG files, then assign one
or more packs to a Bot. Each Bot has its own enable switch and probability.
An explicit request for a sticker bypasses the normal random gate; an explicit
decline disables candidates for that turn.

The model never receives the whole asset library. The steward ranks enabled
stickers by name, meaning and tags, penalizes recently used items, and exposes
at most eight candidate IDs. A model marker is accepted only when its ID is in
that exact candidate set. The marker is removed from visible text before the
reply is sent, and the asset is looked up again by its server-side ID.

Images live under the private data directory (`sticker-assets`), not in the
source repository. The public project contains no private companion-system or
downstream-product sticker assets, labels or paths.
