#!/bin/sh
# three.module.js is copied unchanged from the npm tarball three@0.170.0 (build/three.module.js,
# sha256 of the tarball 4a608a355dcaba72e0e5383cdc814303f5b6060b43c238cdf6932dceb699238d).
# Chrome will not load an ES module from a file:// page, so this writes the same code as a classic
# script that sets window.THREE: the file is wrapped in a function and its one export statement
# becomes an object. Nothing else changes. Run from this folder: sh make-global.sh
cd "$(dirname "$0")"
{
  printf '/* three.js r170, MIT licence (see LICENSE). Generated from three.module.js by make-global.sh. */\n(function () {\n'
  sed 's/^export {\(.*\)};$/window.THREE = {\1};/' three.module.js
  printf '\n})();\n'
} > three.global.js
grep -c '^window.THREE = {' three.global.js
