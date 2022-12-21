FROM node:19.3-alpine
RUN apk --update add \
    ffmpeg \
    openssl \
    perl-mojolicious \
    perl-lwp-protocol-https \
    perl-xml-simple \
    perl-xml-libxml

RUN apk add atomicparsley --repository http://dl-3.alpinelinux.org/alpine/edge/testing/ --allow-untrusted && ln -s `which atomicparsley` /usr/local/bin/AtomicParsley

RUN mkdir -p /data/output /data/config

WORKDIR /app

ENV GET_IPLAYER_VERSION=3.30

RUN wget -qO- https://github.com/get-iplayer/get_iplayer/archive/v${GET_IPLAYER_VERSION}.tar.gz | tar -xvz -C /tmp && \
    mv /tmp/get_iplayer-${GET_IPLAYER_VERSION}/get_iplayer . && \
    rm -rf /tmp/* && \
    chmod +x ./get_iplayer
RUN /app/get_iplayer --refresh
WORKDIR /usr/src/app
COPY package.json ./
RUN mkdir tmp
RUN apk --no-cache add git
RUN apk --no-cache add curl
RUN npm install
COPY . .
HEALTHCHECK --interval=1m --start-period=3s CMD curl  --fail http://localhost:1800/ || exit 1
CMD ["node", "index.js"]