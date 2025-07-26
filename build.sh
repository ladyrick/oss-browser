#!/bin/bash
cd "$(dirname "$0")"

if [[ -d node_modules ]]; then
    yarn install --frozen-lockfile
    yarn build
fi

rm -rf oss-browser
mkdir oss-browser
cp -r dist run.sh server.py oss-browser
tar zcvf oss-browser.tar.gz oss-browser
rm -rf oss-browser
