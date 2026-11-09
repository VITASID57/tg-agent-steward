FROM node:22-bookworm-slim

ARG INSTALL_SUBSCRIPTION_CLIS=0
ARG CODEX_CLI_VERSION=0.167.0
ARG GROK_CLI_VERSION=1.0.77

WORKDIR /app
ENV NODE_ENV=production \
    TG_STEWARD_HOST=0.0.0.0 \
    TG_STEWARD_PORT=8788 \
    TG_STEWARD_DATA_DIR=/data \
    TG_STEWARD_AUTH_MODE=password

RUN if [ "$INSTALL_SUBSCRIPTION_CLIS" = "1" ]; then \
      apt-get update; \
      apt-get install -y --no-install-recommends bash ca-certificates curl gzip; \
      npm install --global "@openai/codex@${CODEX_CLI_VERSION}"; \
      mkdir -p /opt/grok; \
      curl -fsSL https://x.ai/cli/install.sh \
        | HOME=/opt/grok GROK_BIN_DIR=/opt/grok/.grok/bin bash -s -- "$GROK_CLI_VERSION"; \
      ln -sf /opt/grok/.grok/bin/grok /usr/local/bin/grok; \
      chmod -R a+rX /opt/grok; \
      codex --version; \
      grok --version; \
      rm -rf /var/lib/apt/lists/* /root/.npm; \
    fi

COPY package.json LICENSE ./
COPY src ./src

RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 8788

CMD ["node", "src/server.mjs"]
