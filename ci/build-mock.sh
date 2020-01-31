#!/bin/sh
npm run build || exit 1

npm prune --production || exit 1

rm -rf build/tests 'node_modules/ecma-nacl/c sources'
