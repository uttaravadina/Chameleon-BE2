#!/usr/bin/env bash
docker run --rm -it -p 24224:24224 -p 24224:24224/udp -v ~/Development/chameleon-backend/logs:/fluentd/log -v ~/Development/chameleon-backend/fluent.conf:/fluentd/etc/fluent.conf chameleon/fluentd:latest