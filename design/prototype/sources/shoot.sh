#!/bin/sh
# Builds the harness and takes its screenshots: ./shoot.sh  (from anywhere)
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT" && node_modules/.bin/esbuild design/prototype/sources/harness.ts --bundle --format=iife --alias:@shared=./src/shared \
  --loader:.json=json --define:process.env.NODE_ENV='"production"' --log-level=warning --outfile=design/prototype/sources/harness.js || exit 1
mkdir -p "$HERE/shots"
shot() { # name, query, [height]
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1280,"${3:-900}" --virtual-time-budget=3000 \
    --screenshot="$HERE/shots/$1.png" "file://$HERE/index.html?$2" >/dev/null 2>&1
}
for theme in ${THEMES:-light dark}; do
  shot "docs-$theme" "scene=docs&theme=$theme"
  shot "docs-full-$theme" "scene=docs&theme=$theme&tall=1" 1750
  shot "book-$theme" "scene=book&theme=$theme&tall=1" 1100
  shot "fallback-$theme" "scene=fallback&theme=$theme&tall=1" 1900
done
shot "docs-classic-light" "scene=docs&theme=light&design=classic&tall=1" 1750
shot "docs-classic-dark" "scene=docs&theme=dark&design=classic&tall=1" 1750
shot "docs-sepia-sans" "scene=docs&theme=sepia&face=sans&tall=1" 1750
ls "$HERE/shots"
