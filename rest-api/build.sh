#!/usr/bin/env bash
version=$(cat package.json | grep version | head -1 | awk -F: '{ print $2 }' | sed 's/[\",]//g' | tr -d '[[:space:]]')
docker build -t chameleon/rest-api:latest -t chameleon/rest-api:$version .