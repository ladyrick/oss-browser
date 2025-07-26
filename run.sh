#!/bin/bash
cd "$(dirname "$0")"

if [[ -d node_modules ]]; then
    yarn install --frozen-lockfile
    yarn build
fi

PROD=1 python server.py
