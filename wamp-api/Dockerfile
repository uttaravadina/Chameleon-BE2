FROM node:10.14-alpine
RUN addgroup -g 2000 -S chameleon && adduser -S -u 2000 chameleon -G chameleon
WORKDIR /opt/app
COPY . .
RUN apk --no-cache --virtual build-dependencies add \
    python \
    make \
    g++ \
    && npm install --production \
    && apk del build-dependencies \
    && chown -R chameleon: /opt/app
USER chameleon
CMD ["node", "server.js"]