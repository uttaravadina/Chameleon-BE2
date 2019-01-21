#!/usr/bin/env bash
version=$(cat package.json | grep version | head -1 | awk -F: '{ print $2 }' | sed 's/[\",]//g' | tr -d '[[:space:]]')
docker save --output ../docker-image-archives/scheduler-latest.tar chameleon/scheduler:latest
cp ../docker-image-archives/scheduler-latest.tar ../docker-image-archives/scheduler-$version.tar