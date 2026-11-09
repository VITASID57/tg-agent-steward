# Lumenkeep / 栖光庭

The public repository keeps the descriptive name TG Agent Steward. The control
surface uses the product name 栖光庭 / Lumenkeep: a Telegram connection and
settings console for each Bot. It can connect an external memory service, but it
does not present itself as the place where memories are stored. Gentiana remains
the original botanical art subject, not the product name printed over the poster.

The theme uses ink navy, silver-white and a small pink accent. A botanical
photogram sits beside the control room on desktop and becomes a short banner
on mobile. Inputs, labels and saved state use the existing application APIs.

`src/web/gentian-theme.css` owns the visual layer. `src/web/motion.js` owns the
interruptible entrance/section transitions, navigation indicator, motion
preference and form feedback. No new runtime dependency or remote font is used.
The theme respects `prefers-reduced-motion`; an explicit motion button pauses
the ambient image and light, and background tabs also pause it.

## Bot cards and settings

The Bot page starts with a compact directory grid. Selecting a card opens a
read-only status page with connection, enabled capabilities, actual prompt/tool
diagnostics and provider usage; editing is a separate explicit action. The editor
contains nine collapsible groups and summaries. Collapsing a group
does not disable its inputs; all settings save together. Invalid required inputs
reopen their group. Drafts survive card switches and control-plane refreshes in
the current page, but are not stored across browser reloads. Save each Bot before
leaving. Runtime labels reflect the saved server state, alongside draft markers.

Card images accept PNG, JPEG and WebP up to 10 MB. The browser creates a centered
384 x 576 JPEG preview, discarding source metadata. Cards use a 2:3 portrait
window; Bots without an upload display the complete bundled gentian artwork.
The bounded raster preview is
saved in the authenticated Bot configuration, with no external image host. This
does not change the Telegram account photo. Existing API clients omitting the
avatar retain it; sending an empty string removes it.

The profiles page lists the Bots using each persona. Shared profile edits apply
to subsequent replies from those Bots. Memory sharing remains a separate choice.
“接口格式” replaces “API 风格” and appears only for OpenAI-compatible connections;
its endpoint examples explain the difference without implying a personality style.

## Login and launcher

The management password is stored in the runtime data directory as `.admin-token`,
unless `TG_STEWARD_ADMIN_PASSWORD` overrides it. The legacy
`TG_STEWARD_ADMIN_TOKEN` name remains compatible. The page explains this directly.
`scripts/open-control.ps1` starts or reuses the local server, verifies the token,
and opens a fragment-based login URL. The client clears the fragment immediately
and remembers the token in localStorage for that browser. Closing a tab or the
browser therefore does not require another login. The header's explicit forget
action clears the stored token; legacy sessionStorage values migrate once. The
launcher prints no token.
Run with `-NoBrowser` to verify readiness without opening a browser.

## Original asset

`src/web/assets/gentian-film.png` and the mobile banner
`src/web/assets/gentian-hero-wide-v2.webp` were generated with the built-in
imagegen tool. The originals remain in the generator output directory. No
downloaded reference image, video, account data or token is part of the shipped
theme. The banner keeps the complete flower silhouette inside a wide frame and
leaves calm negative space for the product name and one Chinese positioning line.

Generation prompt:

> Use case: stylized-concept. Create an original botanical art asset for the hero panel of a Telegram bot management web interface. Portrait composition, 1024x1536. Subject: three slender real Gentiana (gentian / 龙胆花) bell-and-trumpet blossoms, each with five pointed petal lobes and long fused tubular corolla, on graceful crossing slender stems with narrow lanceolate leaves. One luminous bloom facing up and toward viewer upper center, one side-facing lower right, a smaller bud at left. Style: fine-art botanical X-ray photogram on translucent photographic film, visible delicate branching veins and the overlapping inside of the petals, almost transparent silver-white membranes, spectral electric cobalt blue edges, only a tiny blush of Barbie pink refracted along one petal and stem. Dark ink navy background #050e28. Luxurious analog film grain, soft halation, exquisite microscopic detail, dramatic transmitted light, serene museum herbarium mood. Flowers occupy central 75 percent with generous dark edges and bottom breathing room. Elegant airy vertical composition. Actual translucent photographic flowers, not vector outlines, not plastic 3D. No text, no lettering, no watermarks, no UI frames, no hands, no vase, no planets, no stars, no butterflies. Asset will have separate interface typography and dynamic light layers added in CSS.

Mobile banner prompt:

> Wide text-free botanical X-ray photogram on a deep ink-navy background. A complete translucent gentian branch with three luminous cobalt and silver-white blossoms occupies the right half, with every petal, bud, leaf and stem fully inside the frame; generous calm negative space remains on the left for interface typography. Fine veins, transmitted light, restrained analog grain and a tiny Barbie-pink refraction accent. No lettering, UI, border, watermark, vase, hand or cropped flower.

## References inspected

- [Translucent botanical film poster](https://www.xiaohongshu.com/explore/6aeb1e9f0000000016005792): text, cover and video frames inspected; inspired veins, transmitted light and film texture.
- [Diatom memory interface](https://x.com/lilin6981/status/2117618275966415280), [dream homepage](https://x.com/lilin6981/status/2113870245480018091), [expansion transitions](https://x.com/lilin6981/status/2111625423528591723), [floating pills](https://x.com/lilin6981/status/2111360780490682658), [flip-phone interface](https://x.com/Suisaeki/status/2117761305285476500), [opening screen](https://x.com/Suisaeki/status/2116145832642941097): text and sequential frames inspected for motion only.

These are inspiration links, not dependencies or copied artwork. The current
theme uses slow scale/light movement, a sliding navigation highlight and
short section entrances; it does not recreate the references' 3D scenes.
