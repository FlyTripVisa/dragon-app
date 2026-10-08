FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV HOME=/root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git \
       curl \
       ca-certificates \
       tini \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g openclaw@latest

RUN mkdir -p /root/.openclaw

WORKDIR /root/.openclaw

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["openclaw", "gateway", "run", "--allow-unconfigured"]