#!/bin/sh
# Builds the harness and takes its screenshots: ./shoot.sh  (from anywhere; THEMES="light dark" by default)
CHROME="$HOME/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT" && node_modules/.bin/esbuild design/prototype/projects/harness.tsx --bundle --format=iife --jsx=automatic --alias:@shared=./src/shared \
  --define:process.env.NODE_ENV='"production"' --loader:.ttf=file --log-level=warning --outfile=design/prototype/projects/harness.js || exit 1
mkdir -p "$HERE/shots"
shot() { # name, query, [height]
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1280,"${3:-900}" --virtual-time-budget=3000 \
    --screenshot="$HERE/shots/$1.png" "file://$HERE/index.html?$2" >/dev/null 2>&1
}
for theme in ${THEMES:-light dark}; do
  shot "failing-$theme" "view=failing&theme=$theme"
  shot "failing-full-$theme" "view=failing&theme=$theme" 2400
  shot "passed-$theme" "view=passed&theme=$theme" 1600
  shot "list-$theme" "view=list&theme=$theme"
  shot "preview-$theme" "view=preview&theme=$theme"
done
ls "$HERE/shots"
