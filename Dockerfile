FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    TG_STEWARD_HOST=0.0.0.0 \
    TG_STEWARD_PORT=8788 \
    TG_STEWARD_DATA_DIR=/data \
    TG_STEWARD_AUTH_MODE=password

COPY package.json LICENSE ./
COPY src ./src

RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 8788

CMD ["node", "src/server.mjs"]
