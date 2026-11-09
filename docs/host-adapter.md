# Host frontend thin adapter

Another frontend should integrate Lumenkeep through a thin adapter instead of
copying its Bot, connection, model, voice, image, memory, or runtime logic.
The host is responsible for its own user interface and for asking the user to
confirm any persona data or network origin before sharing it with Lumenkeep.

A minimal adapter normally provides three actions:

1. check the steward connection status;
2. open the steward settings page;
3. sync a user-confirmed persona through the HTTP API.

Keep host-specific calls behind small functions such as:

```js
async function readConfirmedPersona() {}
async function connectToApprovedStewardOrigin() {}
```

Do not guess undocumented host APIs, bypass the host's iframe or network
policy, open hidden top-level windows, or store the steward management password
in ordinary plugin preferences. Use the host's secret storage when it has one;
otherwise ask the user to open Lumenkeep directly and authenticate there.

The complete control-plane endpoints are documented in [api.md](./api.md).
