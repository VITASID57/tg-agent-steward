# Deployment and phone-only users

## What the management password is

The management password protects one running Lumenkeep control page and its HTTP
API. Internally it is sent as a Bearer credential; users can treat it as their
private dashboard password. It is unrelated to Telegram's Bot Token and
model-provider keys.

- Local startup generates a random password once and stores it in
  `data/.admin-token`.
- Every installation gets its own password. Nothing is shared through GitHub.
- Cloud deployments should set `TG_STEWARD_ADMIN_PASSWORD` to a long private value,
  because many hosting dashboards do not let users open `.admin-token` easily.
- Losing the password does not expose it through the control API. A server owner can
  replace the environment variable and restart the service.

## Why a GitHub repository is not enough

GitHub stores source code. GitHub Pages serves static files. Lumenkeep also needs
a continuously running Node.js process to receive Telegram updates, call models,
keep conversations and store private settings. A phone-only user therefore needs
a cloud runtime even though they do not need to own a computer or VPS.

The cloud service must provide:

1. a continuously running Node.js 22+ / Docker service;
2. an HTTPS public address;
3. outbound HTTPS access to Telegram and selected providers;
4. a persistent volume mounted at `/data`;
5. private environment variables.

Deploy the repository as a Docker service, mount persistent storage at `/data`,
and set at least:

```text
TG_STEWARD_HOST=0.0.0.0
TG_STEWARD_PORT=8788
TG_STEWARD_DATA_DIR=/data
TG_STEWARD_ADMIN_PASSWORD=<a long private value chosen by the user>
TG_STEWARD_ALLOWED_ORIGINS=https://<the public control-page domain>
```

The server also accepts the common injected `PORT` variable when
`TG_STEWARD_PORT` is absent. Set `TG_STEWARD_ALLOWED_ORIGINS` to the exact HTTPS
origin shown in the browser, without a trailing slash. Never commit the
management password, Telegram Bot Token or model keys into GitHub.

After deployment, the user opens the HTTPS address on their phone, enters the
management password they set, then creates connection presets and pastes each
BotFather token in the Bot page.

API-key routes are the simplest phone-only option. Codex, Claude Code and Grok
Build subscription routes require their official CLI and interactive account
login on the same runtime machine, which ordinary phone-oriented hosting may not
support. Account sessions are never baked into the image.

### Optional Codex and Grok Build subscription image

The Dockerfile can install the official Codex and Grok Build CLIs at build time:

```bash
docker build \
  --build-arg INSTALL_SUBSCRIPTION_CLIS=1 \
  -t lumenkeep:subscriptions .
```

Keep each CLI login cache outside the replaceable container. Alongside the
normal `/data` volume, mount two private directories owned by the container user
(UID/GID 1000 by default):

```bash
mkdir -p /srv/lumenkeep/data /srv/lumenkeep/codex-home /srv/lumenkeep/grok-home
chown -R 1000:1000 /srv/lumenkeep

docker run -d --name lumenkeep --restart unless-stopped \
  -p 127.0.0.1:8788:8788 \
  -v /srv/lumenkeep/data:/data \
  -v /srv/lumenkeep/codex-home:/home/node/.codex \
  -v /srv/lumenkeep/grok-home:/home/node/.grok \
  -e TG_STEWARD_ADMIN_PASSWORD='<your management password>' \
  -e TG_STEWARD_ALLOWED_ORIGINS='https://<your control-page domain>' \
  lumenkeep:subscriptions
```

On a remote or headless server, authorize each account with its provider's
device-code flow. The commands print a temporary URL and one-time code; open the
URL on a phone or computer and approve it with the account that owns the
subscription:

```bash
docker exec -it lumenkeep codex login --device-auth
docker exec -it lumenkeep grok login --device-auth
```

Then create one **Codex subscription / CLI** and one **Grok Build subscription /
CLI** preset in **连接预设**, use **拉取模型**, and run the connection self-check.
The mounted login directories contain password-equivalent tokens: never commit,
publish, back up to a public location or paste their contents into the control
page. If a provider revokes or expires a session, run that provider's login
command again; existing Bot and persona settings remain intact.

The included Dockerfile is provider-neutral. A future one-click template can
wrap it for a particular host, but that template must also create persistent
storage and a secret management password; a static “Deploy” button without those
two pieces would lose user configuration or expose the control plane.

For a local computer that listens only on `127.0.0.1`, `localhost` or `::1`, a
user may explicitly set `TG_STEWARD_AUTH_MODE=none`. The page then enters
automatically. The server refuses password-free startup on `0.0.0.0` and other
network-visible addresses because anyone reaching that page could replace Bot
tokens, change connections and operate the configured Bots.

## Exact path for an API user

There is no shared public Lumenkeep website in this repository. Each deployment
serves its own control website and private backend from the same HTTPS address.
A user who has a Telegram Bot and a model API key follows this path:

1. deploy this repository's Dockerfile to a cloud service and attach `/data`;
2. set a management password and the public allowed origin in that service;
3. open the service's HTTPS address on the phone and enter the chosen password;
4. create an OpenAI-compatible, Anthropic-compatible, Vertex AI or other API
   connection in **连接预设**, including the user's own key;
5. open **Bot**, paste the BotFather token, select the connection, model and
   persona, then enable and save the Bot;
6. on the saved Bot card, select **去 Telegram 绑定我**, then press **Start**
   in the private Telegram chat. For later Bots, select **允许我的 Telegram 账号**
   to reuse the verified account. Invite codes are available for other people.

A single centrally hosted website where unrelated users paste their Bot tokens
would be a different product: a multi-tenant hosted service. It would need user
accounts, tenant isolation, encrypted secret ownership, quotas, recovery and a
paid always-on runtime. The current source-available edition is intentionally a
single-owner deployment, so one user's Bot tokens and API keys never enter
another user's Lumenkeep instance.
