#!/bin/bash
cd "$(dirname "$0")"

commit_id="$1"

if [[ -d node_modules ]]; then
    yarn install --frozen-lockfile
    yarn build
fi

rm -rf oss-browser
mkdir oss-browser
cp -r dist run.sh server.py oss-browser
[[ -n "$commit_id" ]] && echo "$commit_id" >oss-browser/commit_id
tar zcvf oss-browser.tar.gz oss-browser
rm -rf oss-browser
