#!/bin/sh
# Builds the harness and takes its screenshots: ./shoot.sh  (from anywhere)
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT" && node_modules/.bin/esbuild design/prototype/humanities/harness.tsx --bundle --format=iife --jsx=automatic --alias:@shared=./src/shared \
  --loader:.json=json --define:process.env.NODE_ENV='"production"' --log-level=warning --outfile=design/prototype/humanities/harness.js || exit 1
mkdir -p "$HERE/shots"
shot() { # name, query
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1280,900 --virtual-time-budget=3000 \
    --screenshot="$HERE/shots/$1.png" "file://$HERE/index.html?$2" >/dev/null 2>&1
}
for theme in ${THEMES:-light dark}; do
  for scene in epub together pdf notes; do shot "$scene-$theme" "scene=$scene&theme=$theme"; done
done
shot "epub-classic-light" "scene=epub&theme=light&design=classic"
ls "$HERE/shots"
